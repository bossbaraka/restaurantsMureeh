import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { config } from '../config';
import { requireAuth, isPlatformUser } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';
import { FREE_PLAN_ID } from '../services/plans';
import {
  ProvisioningError,
  buildInitialTables,
  buildVerificationReference,
  generateUniqueSlug,
  normalizeVerificationPhone,
  verifyRestaurantActivationCode,
} from '../services/restaurantProvisioning';
import {
  getStorage,
  assetNormalizerFor,
  assetUrlResolverFor,
  resolveRestaurantAssets,
} from '../services/storage';
import { selfOnboardLimiter } from '../middleware/rateLimit';
import {
  validateBody,
  selfOnboardSchema,
  onboardingVerifySchema,
} from '../validation/schemas';

/**
 * Self-service restaurant onboarding (2026-10).
 *
 * THE ONLY public path from "account" to "operating tenant". It is strictly
 * separated from platform administration:
 *   * POST /api/admin/onboard-restaurant stays admin-only, unchanged — its
 *     extra policy (logo URLs, plan choice, sample categories/products,
 *     multi-table batches up to 500) must NEVER be reachable unauthenticated.
 *   * This route accepts a venue NAME and one closed table count only. The
 *     server owns everything else: slug, plan binding, membership, QR tokens.
 *
 * Authorization model (no new mechanisms — all reuse middleware/auth):
 *   requireAuth        → fresh session (status + tokenVersion re-validated);
 *   role check         → only RESTAURANT_MANAGER may onboard a tenant for
 *                        themselves; platform staff are rejected here (their
 *                        provisioning path is the admin router), and no
 *                        role/planId/restaurantId input is ever read.
 *
 * Consistency: restaurant + membership claim + subscription + tables live in
 * ONE Prisma transaction — a partial tenant can never exist. No network or
 * asset work runs inside it (asset resolution happens after commit).
 */
const router = Router();

router.use(requireAuth);

// Same single asset contract the auth/admin surfaces use (read-only, lazy).
let onboardingAssetContract: {
  normalizer: ReturnType<typeof assetNormalizerFor>;
  toUrl: (key: string) => string;
} | null = null;
function resolveRestaurantRow(row: {
  logoUrl: string;
  coverImageUrl: string | null;
  mapImageUrl: string | null;
  galleryImages: string[];
}) {
  if (!onboardingAssetContract) {
    const storage = getStorage();
    onboardingAssetContract = {
      normalizer: assetNormalizerFor(storage),
      toUrl: assetUrlResolverFor(storage, config.appUrl),
    };
  }
  return resolveRestaurantAssets(
    row,
    onboardingAssetContract.normalizer,
    onboardingAssetContract.toUrl
  );
}

/**
 * POST /api/onboarding/restaurant
 *
 * Body (closed — .strict()): { name: string, tablesCount: 10 | 15 | 20 }.
 * Rejected by construction: planId, restaurantId, logoUrl, categories,
 * products, status, role — anything a client must never decide.
 */
router.post(
  '/restaurant',
  selfOnboardLimiter,
  validateBody(selfOnboardSchema),
  async (req: Request, res: Response) => {
    const user = req.user!;

    try {
      // ---- authorization (defense in depth over requireAuth) -------------
      if (isPlatformUser(req)) {
        // Platform staff provision through the audited admin router; letting
        // them mint tenants here would bypass the admin flow's policy.
        return res.status(403).json({
          success: false,
          error: 'تستخدم إدارة المنصة مسار تهيئة المطاعم الإداري',
          statusCode: 403,
        });
      }
      if (user.role !== 'RESTAURANT_MANAGER') {
        return res.status(403).json({
          success: false,
          error: 'إنشاء المطاعم متاح لحسابات مديري المطاعم فقط',
          statusCode: 403,
        });
      }
      if (user.restaurantId) {
        // v1 rule: one restaurant per account (the membership MODEL supports
        // many users per tenant; the self-service GRANT stays 1:1).
        return res.status(409).json({
          success: false,
          error: 'حسابك مرتبط بمطعم بالفعل — يمكن إنشاء مطعم واحد لكل حساب',
          statusCode: 409,
        });
      }

      const { name, tablesCount, phone } = req.body as {
        name: string;
        tablesCount: number;
        phone?: string;
      };
      const canonicalPhone = phone ? normalizeVerificationPhone(phone) : null;

      // ---- entitlement precondition --------------------------------------
      // The plan row is data (seed / idempotent migration). If the catalog
      // row is missing the flow must fail LOUDLY like the trial route does —
      // never silently fall back to another plan.
      const plan = await prisma.plan.findUnique({ where: { id: FREE_PLAN_ID } });
      if (!plan || plan.status !== 'ACTIVE') {
        return res.status(503).json({
          success: false,
          error:
            'الخطة المجانية غير متوفرة في كتالوج الباقات — نفّذ أمر البذر (npm run db:seed) أولاً',
          statusCode: 503,
        });
      }
      if (tablesCount > plan.maxTables) {
        // Unreachable while the catalog matches the flow (20 ≤ 20), kept as
        // the invariant that makes "client never picks an over-plan count"
        // a server truth even if ceilings are edited below the choices.
        return res.status(400).json({
          success: false,
          error: `عدد الطاولات المطلوب يتجاوز حد الخطة المجانية (${plan.maxTables})`,
          statusCode: 400,
        });
      }

      // ---- slug: server-generated, uniqueness pre-checked, P2002 is the
      // final arbiter under races (bounded lookups inside the helper).
      const slug = await generateUniqueSlug(name, async (candidate) => {
        const clash = await prisma.restaurant.findUnique({
          where: { slug: candidate },
          select: { id: true },
        });
        return !!clash;
      });
      // Deterministic tenant id, same convention as admin onboarding —
      // table ids and QR print flows embed it ({id}-T01..).
      const restId = `rest-${slug}`;

      // ---- the all-or-nothing provisioning transaction --------------------
      const result = await prisma.$transaction(async (tx) => {
        // THE authoritative identity re-read. Everything the request claimed
        // (role/status/tenantless) is re-verified on the row itself inside
        // the transaction — req.user is a convenience, never the decision.
        const fresh = await tx.restaurantUser.findUnique({
          where: { id: user.id },
          select: { id: true, status: true, role: true, restaurantId: true },
        });
        if (!fresh || fresh.status !== 'ACTIVE') {
          throw new ProvisioningError(401, 'ACCOUNT_UNAVAILABLE', 'الحساب غير متاح');
        }
        if (fresh.role !== 'RESTAURANT_MANAGER') {
          throw new ProvisioningError(403, 'ROLE_DENIED', 'هذا المسار مخصص لمديري المطاعم');
        }
        if (fresh.restaurantId) {
          throw new ProvisioningError(
            409,
            'ALREADY_LINKED',
            'حسابك مرتبط بمطعم بالفعل — يمكن إنشاء مطعم واحد لكل حساب'
          );
        }

        // Triple Free Shield Layer 1: one restaurant per verified contact phone.
        if (canonicalPhone) {
          const existingPhoneTenant = await tx.restaurant.findFirst({
            where: {
              OR: [
                { phone: canonicalPhone },
                { whatsappNumber: canonicalPhone },
              ],
            },
            select: { id: true },
          });
          if (existingPhoneTenant) {
            throw new ProvisioningError(
              409,
              'PHONE_ALREADY_USED',
              'رقم الجوال/واتساب هذا مرتبط بمطعم مسجّل مسبقاً — يُسمح بمطعم واحد لكل رقم تواصل رسمي لمنع الحسابات الوهمية'
            );
          }
        }

        const restaurant = await tx.restaurant.create({
          data: {
            id: restId,
            name,
            // nameEn/description/address: NOT NULL columns get the
            // platform's HONEST empties — the venue fills them later in its
            // branding settings. No invented marketing copy, no fake data.
            nameEn: '',
            slug,
            description: '',
            phone: canonicalPhone ?? '',
            whatsappNumber: canonicalPhone ?? null,
            address: '',
            // '' is the schema-documented "no logo" marker; every surface
            // falls back to the platform default (BrandMark/initial avatar).
            logoUrl: '',
            // Triple Free Shield Layer 3: self-onboarded venues start in
            // ONBOARDING quarantine until verified via the Official
            // Verification Gate (6-digit activation code or admin approval).
            status: 'ONBOARDING',
            planId: plan.id,
          },
        });

        // Membership CLAIM: the conditional update is the concurrency gate.
        // Two racing transactions serialize on this user row; the loser
        // matches 0 rows and the whole transaction (restaurant, subscription,
        // tables) rolls back with it. The UI's disabled-button state is UX —
        // THIS is the duplicate-submission protection.
        const claimed = await tx.restaurantUser.updateMany({
          where: { id: fresh.id, restaurantId: null },
          data: { restaurantId: restaurant.id },
        });
        if (claimed.count !== 1) {
          throw new ProvisioningError(
            409,
            'ALREADY_LINKED',
            'حسابك مرتبط بمطعم بالفعل — يمكن إنشاء مطعم واحد لكل حساب'
          );
        }

        // Permanent-free subscription: a normal 30-day period is stored for
        // catalog symmetry, but the lifecycle treats billingPeriod 'free' as
        // perpetually entitled (plans.ts), so it can never expire the venue.
        // trialEndsAt stays NULL — the free plan must not consume the
        // platform-admin trial grant (evaluateTrialActivation keys on it).
        const now = new Date();
        await tx.subscription.create({
          data: {
            restaurantId: restaurant.id,
            planId: plan.id,
            status: 'ACTIVE',
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 30 * 86400 * 1000),
          },
        });

        // Tables + QR tokens — shared builder, closed count, DB-unique
        // (restaurantId, number). createMany keeps it ONE statement.
        const tablesData = buildInitialTables(restaurant.id, tablesCount);
        await tx.table.createMany({ data: tablesData });

        return { restaurant, tablesCreated: tablesData.length };
      });

      // ---- post-commit: read-only asset resolution + audit ----------------
      const resolved = resolveRestaurantRow(result.restaurant);
      const verificationReference = buildVerificationReference(result.restaurant.id);

      await logAuditEvent({
        restaurantId: result.restaurant.id,
        userId: user.id,
        actor: user.name,
        actorRole: user.role,
        action: 'RESTAURANT_SELF_ONBOARDED',
        entity: 'Restaurant',
        entityId: result.restaurant.id,
        details: `تم تقديم طلب تدشين مطعم ذاتياً (بوابة التحقق الرسمي ${verificationReference}): ${result.restaurant.name} (${result.restaurant.slug}) مع ${result.tablesCreated} طاولة — الخطة: ${plan.name}`,
        ipAddress: req.ip,
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        data: {
          restaurant: {
            ...result.restaurant,
            logoUrl: resolved.logoUrl,
            coverImageUrl: resolved.coverImageUrl,
            mapImageUrl: resolved.mapImageUrl,
            galleryImages: resolved.galleryImages,
            logoStoragePath: resolved.logoStoragePath,
          },
          tablesCount: result.tablesCreated,
          planId: plan.id,
          planName: plan.name,
          verificationRequired: true,
          verificationReference,
        },
        statusCode: 201,
      });
    } catch (err: unknown) {
      // Stable, non-leaking mapping of expected failures.
      if (err instanceof ProvisioningError) {
        if (err.statusCode === 401 || err.statusCode === 403) {
          await logAuditEvent({
            restaurantId: req.user?.restaurantId ?? null,
            userId: req.user?.id,
            actor: req.user?.name ?? 'unknown',
            actorRole: 'RESTAURANT_MANAGER',
            action: 'SELF_ONBOARD_DENIED',
            details: `محاولة إنشاء مطعم مرفوضة (${err.code}) عبر ${req.ip ?? 'unknown ip'}`,
            ipAddress: req.ip,
          }).catch(() => {});
        }
        return res.status(err.statusCode).json({
          success: false,
          error: err.message,
          statusCode: err.statusCode,
        });
      }
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        // Slug race past the bounded pre-check (or a table-number collision
        // from a legacy row): unique constraints won — nothing was persisted
        // because the whole transaction rolls back.
        return res.status(409).json({
          success: false,
          error: 'اسم المطعم محجوز حالياً — أعد المحاولة وستحصل على رابط آخر',
          statusCode: 409,
        });
      }
      console.error('Self-onboarding error:', err);
      return res.status(500).json({
        success: false,
        error: 'تعذر إنشاء المطعم. يرجى المحاولة لاحقاً.',
        statusCode: 500,
      });
    }
  }
);

/**
 * GET /api/onboarding/status
 *
 * Returns the current Official Verification Gate state for a signed-in
 * RESTAURANT_MANAGER whose restaurant is in ONBOARDING (or freshly activated
 * to ACTIVE by a platform admin). Never exposes the secret 6-digit HMAC
 * activation code — only the public `verificationReference` (`MRH-XXXXXX`).
 */
router.get('/status', async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    if (user.role !== 'RESTAURANT_MANAGER' || !user.restaurantId) {
      return res.status(404).json({
        success: false,
        error: 'لا يوجد طلب تدشين مرتبط بهذا الحساب حالياً',
        statusCode: 404,
      });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: user.restaurantId },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { tables: true } },
      },
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'المطعم غير موجود',
        statusCode: 404,
      });
    }

    const resolved = resolveRestaurantRow(restaurant);
    const verificationReference = buildVerificationReference(restaurant.id);

    return res.json({
      success: true,
      data: {
        restaurant: {
          ...restaurant,
          logoUrl: resolved.logoUrl,
          coverImageUrl: resolved.coverImageUrl,
          mapImageUrl: resolved.mapImageUrl,
          galleryImages: resolved.galleryImages,
          logoStoragePath: resolved.logoStoragePath,
        },
        status: restaurant.status,
        verified: restaurant.status === 'ACTIVE',
        verificationReference,
        tablesCount: restaurant._count.tables,
        planName: restaurant.subscription?.plan?.name || 'الخطة المجانية الدائمة',
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Onboarding status error:', err);
    return res.status(500).json({
      success: false,
      error: 'تعذر التحقق من حالة اعتماد المطعم',
      statusCode: 500,
    });
  }
});

/**
 * POST /api/onboarding/verify
 *
 * Official Verification Gate (Triple Free Shield Layer 2):
 * Accepts the 6-digit Official Activation Code issued by platform management
 * (or after WhatsApp reverse verification) and transitions the restaurant
 * from `ONBOARDING` quarantine to `ACTIVE`.
 */
router.post(
  '/verify',
  selfOnboardLimiter,
  validateBody(onboardingVerifySchema),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const { code } = req.body as { code: string };

    try {
      if (isPlatformUser(req) || user.role !== 'RESTAURANT_MANAGER') {
        return res.status(403).json({
          success: false,
          error: 'هذا المسار مخصص لمديري المطاعم فقط',
          statusCode: 403,
        });
      }
      if (!user.restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'أكمل خطوة تسجيل بيانات المطعم أولاً قبل إدخال رمز التفعيل',
          statusCode: 400,
        });
      }

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: user.restaurantId },
      });
      if (!restaurant) {
        return res.status(404).json({
          success: false,
          error: 'المطعم غير موجود',
          statusCode: 404,
        });
      }

      if (restaurant.status === 'ACTIVE') {
        const resolved = resolveRestaurantRow(restaurant);
        return res.json({
          success: true,
          data: {
            restaurant: {
              ...restaurant,
              logoUrl: resolved.logoUrl,
              coverImageUrl: resolved.coverImageUrl,
              mapImageUrl: resolved.mapImageUrl,
              galleryImages: resolved.galleryImages,
              logoStoragePath: resolved.logoStoragePath,
            },
            verified: true,
            alreadyVerified: true,
            verificationReference: buildVerificationReference(restaurant.id),
          },
          statusCode: 200,
        });
      }

      if (restaurant.status !== 'ONBOARDING') {
        return res.status(403).json({
          success: false,
          error: 'حساب المطعم موقوف حالياً من قبل إدارة المنصة',
          statusCode: 403,
        });
      }

      const isValid = verifyRestaurantActivationCode(
        restaurant.id,
        code,
        config.jwtSecret
      );
      if (!isValid) {
        await logAuditEvent({
          restaurantId: restaurant.id,
          userId: user.id,
          actor: user.name,
          actorRole: user.role,
          action: 'RESTAURANT_VERIFICATION_FAILED',
          entity: 'Restaurant',
          entityId: restaurant.id,
          details: `محاولة إدخال رمز تفعيل رسمي غير صحيح لمطعم ${restaurant.name} (${restaurant.slug})`,
          ipAddress: req.ip,
        }).catch(() => {});

        return res.status(400).json({
          success: false,
          error:
            'رمز التفعيل الرسمي غير صحيح — تأكد من الرمز المكون من 6 أرقام الصادر من منصة مريح',
          statusCode: 400,
        });
      }

      const activated = await prisma.restaurant.update({
        where: { id: restaurant.id },
        data: { status: 'ACTIVE' },
      });

      const resolved = resolveRestaurantRow(activated);
      const verificationReference = buildVerificationReference(activated.id);

      await logAuditEvent({
        restaurantId: activated.id,
        userId: user.id,
        actor: user.name,
        actorRole: user.role,
        action: 'RESTAURANT_VERIFIED_AND_ACTIVATED',
        entity: 'Restaurant',
        entityId: activated.id,
        details: `تم توثيق وتفعيل المطعم رسمياً عبر بوابة التحقق (${verificationReference}): ${activated.name} (${activated.slug})`,
        ipAddress: req.ip,
      }).catch(() => {});

      return res.json({
        success: true,
        data: {
          restaurant: {
            ...activated,
            logoUrl: resolved.logoUrl,
            coverImageUrl: resolved.coverImageUrl,
            mapImageUrl: resolved.mapImageUrl,
            galleryImages: resolved.galleryImages,
            logoStoragePath: resolved.logoStoragePath,
          },
          verified: true,
          verificationReference,
        },
        statusCode: 200,
      });
    } catch (err) {
      console.error('Onboarding verify error:', err);
      return res.status(500).json({
        success: false,
        error: 'تعذر إتمام التحقق الرسمي للمطعم. يرجى المحاولة لاحقاً.',
        statusCode: 500,
      });
    }
  }
);

export default router;