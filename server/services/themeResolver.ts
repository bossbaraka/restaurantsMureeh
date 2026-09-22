import { prisma } from '../db/prisma';
import { config } from '../config';
import { getStorage, assetUrlResolverFor, assetNormalizerFor, keyBelongsToRestaurant, isStorageKey } from './storage';
import { resolveRestaurantAssets } from './storage/resolve';
import type { Prisma } from '@prisma/client';

// ============================================================
// Central Theme Resolver — Platform → Restaurant → Branch
// Single source of truth for effective theme applied to public menu.
// ============================================================

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface BackgroundImageRef {
  storagePath: string;
  aiGenerated?: boolean;
  source?: 'upload' | 'gallery' | 'ai' | 'preset';
  presetId?: string;
}

export interface BackgroundConfig {
  type: 'solid' | 'gradient' | 'image' | 'image+overlay' | 'none';
  color?: string;
  gradient?: string;
  image?: BackgroundImageRef;
  overlay?: string;
  overlayOpacity?: number;
  blur?: number;
  position?: string;
  size?: 'cover' | 'contain' | 'auto';
  readability?: {
    scrimOpacity?: number;
    textShadow?: boolean;
  };
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  button?: {
    primaryBg?: string;
    primaryText?: string;
    secondaryBg?: string;
    secondaryText?: string;
  };
  card?: {
    bg?: string;
    border?: string;
    shadow?: string;
    radius?: string;
  };
  badge?: {
    bg?: string;
    text?: string;
  };
  category?: {
    bg?: string;
    text?: string;
    activeBg?: string;
    activeText?: string;
  };
}

export interface ThemeRadius {
  sm?: string;
  md?: string;
  lg?: string;
  xl?: string;
  full?: string;
}

export interface ThemeShadows {
  sm?: string;
  md?: string;
  lg?: string;
}

export interface ThemeTypography {
  fontFamily?: 'tajawal' | 'cairo' | 'amiri' | 'cormorant' | 'auto';
  headingWeight?: number;
  bodyWeight?: number;
}

export interface ThemeConfig {
  mode?: ThemeMode;
  colors?: ThemeColors;
  radius?: ThemeRadius;
  shadows?: ThemeShadows;
  typography?: ThemeTypography;
  background?: {
    light?: BackgroundConfig;
    dark?: BackgroundConfig;
  };
}

export interface ResolvedBackground {
  type: BackgroundConfig['type'];
  color?: string;
  gradient?: string;
  url?: string | null;
  storagePath?: string | null;
  aiGenerated?: boolean;
  overlay?: string;
  overlayOpacity?: number;
  blur?: number;
  position?: string;
  size?: string;
  readability?: BackgroundConfig['readability'];
}

export interface ResolvedTheme {
  mode: ThemeMode;
  colors: ThemeColors;
  radius: ThemeRadius;
  shadows: ThemeShadows;
  typography: ThemeTypography;
  background: {
    light: ResolvedBackground;
    dark: ResolvedBackground;
  };
  source: 'branch' | 'restaurant' | 'platform' | 'fallback';
  // Raw config for manager UI (unresolved)
  rawConfig: ThemeConfig;
}

// Hardcoded fallback — mirrors legacy #D4AF37/#C5A880 dark #0A0B0D.
//
// NOTE (black-card fix): the per-component colour groups (button/card/badge/
// category) are DELIBERATELY ABSENT here. They used to be materialized with
// platform-DARK values (#15171A card, #1F2226 chips, …) into every resolved
// theme, which made "absent" indistinguishable from "the tenant explicitly
// chose a dark card": every light-mode menu rendered near-black cards, and
// the mode-aware derived fallbacks (--m-card-bg gradient et al.) were
// unreachable. Absent groups now stay absent so the client derives them
// per-mode from the brand; explicit tenant choices still pass through.
export const FALLBACK_THEME: ResolvedTheme = {
  mode: 'auto',
  colors: {
    primary: '#D4AF37',
    secondary: '#C5A880',
    accent: '#C5A880',
    background: '#0A0B0D',
    surface: '#15171A',
    textPrimary: '#F5F5F0',
    textSecondary: '#A0A0A0',
    border: '#2A2D32',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 3px rgba(0,0,0,0.3)',
    md: '0 4px 20px rgba(0,0,0,0.4)',
    lg: '0 10px 40px rgba(0,0,0,0.5)',
  },
  typography: {
    fontFamily: 'auto',
    headingWeight: 700,
    bodyWeight: 400,
  },
  background: {
    light: {
      type: 'solid',
      color: '#FFFFFF',
      url: null,
      storagePath: null,
    },
    dark: {
      type: 'solid',
      color: '#0A0B0D',
      url: null,
      storagePath: null,
    },
  },
  source: 'fallback',
  rawConfig: {},
};

// Default platform theme config — used when no platform row exists.
// Same contract as FALLBACK_THEME: no per-component colour groups are
// materialized (see the black-card note above); groups appear in a resolved
// theme only when a real Theme row (platform/restaurant/branch) set them.
export const DEFAULT_PLATFORM_CONFIG: ThemeConfig = {
  mode: 'auto',
  colors: {
    primary: '#D4AF37',
    secondary: '#C5A880',
    accent: '#C5A880',
    background: '#0A0B0D',
    surface: '#15171A',
    textPrimary: '#F5F5F0',
    textSecondary: '#A0A0A0',
    border: '#2A2D32',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 3px rgba(0,0,0,0.3)',
    md: '0 4px 20px rgba(0,0,0,0.4)',
    lg: '0 10px 40px rgba(0,0,0,0.5)',
  },
  typography: {
    fontFamily: 'auto',
    headingWeight: 700,
    bodyWeight: 400,
  },
  background: {
    light: {
      type: 'solid',
      color: '#FFFFFF',
    },
    dark: {
      type: 'solid',
      color: '#0A0B0D',
    },
  },
};

// Deep merge — Platform → Restaurant → Branch (no lockedFields)
export function mergeThemeConfigs(base: ThemeConfig, override: ThemeConfig): ThemeConfig {
  const result: any = { ...base };
  for (const key of Object.keys(override)) {
    const overrideVal = (override as any)[key];
    const baseVal = (base as any)[key];
    if (
      overrideVal &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      baseVal &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = mergeThemeConfigs(baseVal, overrideVal);
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal;
    }
  }
  return result;
}

// Resolve background image storagePath → URL, tenant-checked
function resolveBackgroundConfig(
  bg: BackgroundConfig | undefined,
  restaurantId: string | null,
  toUrl: (key: string) => string
): ResolvedBackground {
  if (!bg) {
    return {
      type: 'none',
      url: null,
      storagePath: null,
    };
  }

  let url: string | null = null;
  let storagePath: string | null = null;
  let aiGenerated: boolean | undefined = undefined;

  if ((bg.type === 'image' || bg.type === 'image+overlay') && bg.image?.storagePath) {
    const key = bg.image.storagePath;
    // Validate storagePath shape
    if (isStorageKey(key)) {
      // For tenant themes, enforce ownership; platform default (restaurantId null) skips check
      if (!restaurantId || keyBelongsToRestaurant(key, restaurantId)) {
        storagePath = key;
        aiGenerated = bg.image.aiGenerated;
        try {
          url = toUrl(key);
        } catch {
          url = null;
        }
      } else {
        // Foreign tenant key — treat as missing (security)
        storagePath = null;
        url = null;
      }
    } else {
      // Invalid storagePath — reject (no URL)
      storagePath = null;
      url = null;
    }
  }

  return {
    type: bg.type,
    color: bg.color,
    gradient: bg.gradient,
    url,
    storagePath,
    aiGenerated,
    overlay: bg.overlay,
    overlayOpacity: bg.overlayOpacity,
    blur: bg.blur,
    position: bg.position,
    size: bg.size,
    readability: bg.readability,
  };
}

// Main resolver — with backward compat for legacy branding
// Order: FALLBACK (DEFAULT_PLATFORM_CONFIG) → Platform Theme → Restaurant legacy primary/accent → Restaurant Theme → Branch Theme
// Legacy colors are a fallback layer, never creates a Theme row, and Restaurant Theme overrides them.
export async function resolveEffectiveTheme(params: {
  restaurantId: string;
  branchId?: string | null;
}): Promise<ResolvedTheme> {
  const { restaurantId, branchId } = params;

  const storage = getStorage();
  const toUrl = assetUrlResolverFor(storage, config.appUrl);

  // Fetch platform default, restaurant theme, branch theme, branch ownership, and legacy branding in parallel
  const [platformRow, restaurantRow, branchRow, branchCheck, restaurantBranding] = await Promise.all([
    prisma.theme.findFirst({
      where: { restaurantId: null, branchId: null },
    }),
    prisma.theme.findFirst({
      where: { restaurantId, branchId: null },
    }),
    branchId
      ? prisma.theme.findFirst({
          where: { restaurantId, branchId },
        })
      : Promise.resolve(null),
    branchId
      ? prisma.branch.findFirst({
          where: { id: branchId, restaurantId },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.restaurant.findFirst({
      where: { id: restaurantId },
      select: { primaryColor: true, accentColor: true },
    }),
  ]);

  // Security: if branchId supplied but doesn't belong to restaurant, ignore branch theme
  const validBranchId = branchCheck ? branchId : null;

  const platformConfig = (platformRow?.config as ThemeConfig) || DEFAULT_PLATFORM_CONFIG;
  // Legacy branding layer — Restaurant primaryColor/accentColor as fallback (no Theme row created)
  let legacyConfig: ThemeConfig = {};
  if (restaurantBranding) {
    const pc = restaurantBranding.primaryColor?.trim();
    const ac = restaurantBranding.accentColor?.trim();
    if (pc || ac) {
      legacyConfig = {
        colors: {
          ...(pc ? { primary: pc } : {}),
          ...(ac ? { secondary: ac, accent: ac } : {}),
        },
      } as ThemeConfig;
    }
  }
  const restaurantConfig = (restaurantRow?.config as ThemeConfig) || {};
  const branchConfig = validBranchId && branchRow ? (branchRow.config as ThemeConfig) : {};

  // Merge: FALLBACK (DEFAULT_PLATFORM_CONFIG) → Platform → Legacy → Restaurant → Branch
  let merged = mergeThemeConfigs(DEFAULT_PLATFORM_CONFIG, platformConfig);
  merged = mergeThemeConfigs(merged, legacyConfig);
  merged = mergeThemeConfigs(merged, restaurantConfig);
  if (validBranchId) {
    merged = mergeThemeConfigs(merged, branchConfig);
  }

  // Determine source
  let source: ResolvedTheme['source'] = 'fallback';
  if (validBranchId && branchRow) source = 'branch';
  else if (restaurantRow) source = 'restaurant';
  else if (platformRow) source = 'platform';
  else source = 'fallback';

  // Resolve backgrounds to URLs
  const lightBg = resolveBackgroundConfig(merged.background?.light, restaurantId, toUrl);
  const darkBg = resolveBackgroundConfig(merged.background?.dark, restaurantId, toUrl);

  // Build resolved theme with defaults filled
  const resolved: ResolvedTheme = {
    mode: merged.mode || 'auto',
    colors: {
      ...FALLBACK_THEME.colors,
      ...(merged.colors || {}),
      // Per-component colour groups pass through ONLY when some layer of the
      // cascade actually set them. They must never be materialized with
      // platform-dark fill values: an absent group is what lets the client
      // derive the component surface per-mode (see FALLBACK_THEME note).
      ...(merged.colors?.button ? { button: { ...merged.colors.button } } : {}),
      ...(merged.colors?.card ? { card: { ...merged.colors.card } } : {}),
      ...(merged.colors?.badge ? { badge: { ...merged.colors.badge } } : {}),
      ...(merged.colors?.category ? { category: { ...merged.colors.category } } : {}),
    },
    radius: {
      ...FALLBACK_THEME.radius,
      ...(merged.radius || {}),
    },
    shadows: {
      ...FALLBACK_THEME.shadows,
      ...(merged.shadows || {}),
    },
    typography: {
      ...FALLBACK_THEME.typography,
      ...(merged.typography || {}),
    },
    background: {
      light: lightBg,
      dark: darkBg,
    },
    source,
    rawConfig: merged,
  };

  return resolved;
}

/**
 * Extracts the BRAND IDENTITY pair (primary/accent) from a theme config so a
 * restaurant-scope theme save can keep the legacy `Restaurant.primaryColor`
 * / `accentColor` columns in sync. This closes the split-brain that made
 * branding edits stop reflecting on the menu: the resolver gives Theme rows
 * precedence over the legacy columns, so whenever both stores existed they
 * could disagree, and consumers still reading the columns (old payloads,
 * cached clients) showed the stale brand.
 *
 * Returns null when the config carries no usable color pair (nothing to sync).
 */
export function extractLegacyBrandColors(config: ThemeConfig | null | undefined): {
  primaryColor: string;
  accentColor: string;
} | null {
  const colors = config?.colors;
  if (!colors) return null;
  const primary = typeof colors.primary === 'string' ? colors.primary.trim() : '';
  const accent = typeof colors.accent === 'string' ? colors.accent.trim() : '';
  if (!primary || !accent) return null;
  return { primaryColor: primary, accentColor: accent };
}

// For manager/admin: get raw stored theme (no merge)
export async function getStoredTheme(params: {
  restaurantId?: string | null;
  branchId?: string | null;
}): Promise<{ id: string; config: ThemeConfig; createdAt: Date; updatedAt: Date } | null> {
  const where: Prisma.ThemeWhereInput = {};
  if (params.restaurantId === null || params.restaurantId === undefined) {
    where.restaurantId = null;
  } else {
    where.restaurantId = params.restaurantId;
  }
  if (params.branchId === null || params.branchId === undefined) {
    where.branchId = null;
  } else {
    where.branchId = params.branchId;
  }
  // For platform default, both null
  const row = await prisma.theme.findFirst({ where });
  if (!row) return null;
  return {
    id: row.id,
    config: row.config as ThemeConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
