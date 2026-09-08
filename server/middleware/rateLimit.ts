import { rateLimit } from 'express-rate-limit';

// ============================================================
// Server-side rate limiting (OWASP API4 / CWE-307).
//
// Client-side lockouts are UX only and MUST NOT be trusted.
// These limiters are per-instance in-memory stores: correct for a
// single Node process. For multi-instance production, replace the
// store with Redis (see express-rate-limit docs) — noted in the
// hardening guide.
// ============================================================

function limiterError(message: string) {
  return {
    success: false,
    error: message,
    statusCode: 429,
  };
}

const base = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  // The app validates proxy configuration itself (TRUST_PROXY env);
  // disable the package's own startup validation noise.
  validate: false as const,
};

// Login: count only failed attempts so normal users are unaffected.
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: limiterError(
    'محاولات دخول كثيرة. يرجى الانتظار 15 دقيقة قبل إعادة المحاولة.'
  ),
});

// Staff PIN: short secrets need a much tighter budget.
export const pinLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: limiterError(
    'محاولات PIN كثيرة. يرجى الانتظار 15 دقيقة قبل إعادة المحاولة.'
  ),
});

export const passwordResetLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: limiterError('طلبات كثيرة لاستعادة كلمة المرور. حاول لاحقاً.'),
});

// Anonymous order intake: generous for a busy venue, bounded for abuse.
export const publicOrderLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 120,
  message: limiterError('طلبات كثيرة من هذا الجهاز. يرجى الانتظار قليلاً.'),
});

export const waiterCallLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 40,
  message: limiterError('نداءات كثيرة من هذا الجهاز. يرجى الانتظار قليلاً.'),
});

export const qrSessionLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 120,
  message: limiterError('طلبات جلسات كثيرة. يرجى الانتظار قليلاً.'),
});

export const uploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: limiterError('تجاوزت حد رفع الملفات المسموح. حاول لاحقاً.'),
});

// ---------- P1 additional limiters (non-breaking, targeted) ----------

// Tenant onboarding is privileged and rare — brute force / spam must be bounded.
export const adminOnboardLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: limiterError('محاولات إنشاء مطاعم كثيرة. حاول لاحقاً.'),
});

export const paymentLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: limiterError('عمليات دفع كثيرة. يرجى الانتظار قليلاً.'),
});

export const orderStatusLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 200,
  message: limiterError('تحديثات حالة كثيرة. يرجى الانتظار قليلاً.'),
});

export const staffMutationLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: limiterError('عمليات موظفين كثيرة. حاول لاحقاً.'),
});
