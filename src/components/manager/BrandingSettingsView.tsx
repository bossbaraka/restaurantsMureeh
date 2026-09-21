import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { api, isEmbeddedImage, uiThemeConfigFromServer } from '../../services/api';
import { optimizeImageFile } from '../../utils/imageOptimize';
import { applyBrandTheme, getCachedBrandTheme, buildEffectiveThemeVars, parseColor, rgbToHex, resolveThemeShadow, themeShadowKey } from '../../theme/brandTheme';
import {
  AlertTriangle,
  Palette,
  Save,
  Image as ImageIcon,
  Upload,
  Phone,
  MapPin,
  Smartphone,
  Star,
  Loader2,
  Wand2,
  RefreshCcw,
  Check,
  Plus,
  UtensilsCrossed,
  Clock,
  Video,
  Film,
  Camera,
  Trash2,
  Coffee,
  Croissant,
  Landmark,
  Wallet,
  CreditCard,
  Sun,
  Moon,
  Monitor,
  RotateCcw,
  Layers,
  Type,
  Square,
  Sparkles,
  Eye,
} from 'lucide-react';
import type { BusinessType, ThemeConfig, EffectiveTheme, ThemeRow, BackgroundConfig, ThemeMode, BackgroundType, ThemeFontKey, ThemeColors, ResolvedBackground } from '../../types/restaurant';

const BUSINESS_TYPES: Array<{
  id: BusinessType;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'RESTAURANT', label: 'مطعم', desc: 'طلب من الطاولة + نداء النادل', icon: UtensilsCrossed },
  { id: 'CAFE', label: 'كافيه', desc: 'طلب سريع + تيك أواي', icon: Coffee },
  { id: 'BAKERY', label: 'مخبز / مشروع طعام', desc: 'استعراض منتجات + استلام', icon: Croissant },
];

const SOCIAL_FIELDS: Array<{
  key: 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'website';
  label: string;
  placeholder: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  stateKey: 'instagramUrl' | 'facebookUrl' | 'tiktokUrl' | 'youtubeUrl' | 'websiteUrl';
}> = [
  { key: 'instagram', label: 'إنستغرام', placeholder: 'https://www.instagram.com/yourvenue', hint: 'رابط HTTPS من نطاق instagram.com', icon: Camera, stateKey: 'instagramUrl' },
  { key: 'facebook', label: 'فيسبوك', placeholder: 'https://www.facebook.com/yourvenue', hint: 'رابط HTTPS من نطاق facebook.com', icon: Landmark, stateKey: 'facebookUrl' },
  { key: 'tiktok', label: 'تيك توك', placeholder: 'https://www.tiktok.com/@yourvenue', hint: 'رابط HTTPS من نطاق tiktok.com', icon: Film, stateKey: 'tiktokUrl' },
  { key: 'youtube', label: 'يوتيوب', placeholder: 'https://www.youtube.com/@yourvenue', hint: 'رابط HTTPS من نطاق youtube.com', icon: Video, stateKey: 'youtubeUrl' },
  { key: 'website', label: 'الموقع الإلكتروني', placeholder: 'https://yourvenue.com', hint: 'موقعك الرسمي — رابط HTTPS صالح', icon: Star, stateKey: 'websiteUrl' },
];

const THEME_PRESETS: Array<{ id: string; label: string; desc: string; primary: string; accent: string }> = [
  { id: 'royal-gold', label: 'ذهبي ملكي', desc: 'كلاسيكي فاخر دافئ', primary: '#D4AF37', accent: '#8C6D1F' },
  { id: 'midnight-blue', label: 'أزرق ليلي', desc: 'هادئ وعصري وأنيق', primary: '#4F7CFF', accent: '#1E2F6E' },
  { id: 'emerald', label: 'زمردي ملكي', desc: 'انتعاش وثقة راقية', primary: '#10B981', accent: '#065F46' },
  { id: 'amber', label: 'عنبري دافئ', desc: 'طاقة ودفء ترحيبي', primary: '#F59E0B', accent: '#92400E' },
  { id: 'rose', label: 'وردي فاخر', desc: 'ناعم للمقاهي والبووتيك', primary: '#EC4899', accent: '#831843' },
  { id: 'wine', label: 'نبيذي داكن', desc: 'فخامة مطاعم اللحوم', primary: '#C0392B', accent: '#5C1A12' },
  { id: 'silver', label: 'فضي معدني', desc: 'حديث بسيط نظيف', primary: '#94A3B8', accent: '#3E4A5B' },
];

// Exactly the five faces the server contract persists (THEME_FONT_KEYS) and
// the five the document actually loads — a picker option outside this set
// could never survive a save (strict schema) and would render as a fallback
// stack anyway, so it must not be offered.
const FONT_OPTIONS: Array<{ id: ThemeFontKey; label: string; family: string }> = [
  { id: 'auto', label: 'تلقائي', family: 'system-ui' },
  { id: 'tajawal', label: 'Tajawal', family: 'Tajawal' },
  { id: 'cairo', label: 'Cairo', family: 'Cairo' },
  { id: 'amiri', label: 'Amiri', family: 'Amiri' },
  { id: 'cormorant', label: 'Cormorant', family: 'Cormorant Garamond' },
];

const BG_TYPES: Array<{ id: BackgroundType; label: string }> = [
  { id: 'solid', label: 'لون ثابت' },
  { id: 'gradient', label: 'تدرج لوني' },
  { id: 'image', label: 'صورة كاملة' },
  { id: 'image+overlay', label: 'صورة + Overlay' },
];

const LOGO_POSITION_GRID: Array<{ label: string; value: string }> = [
  { label: 'أعلى يمين', value: '100% 0%' },
  { label: 'أعلى وسط', value: '50% 0%' },
  { label: 'أعلى يسار', value: '0% 0%' },
  { label: 'وسط يمين', value: '100% 50%' },
  { label: 'وسط المنتصف', value: '50% 50%' },
  { label: 'وسط يسار', value: '0% 50%' },
  { label: 'أسفل يمين', value: '100% 100%' },
  { label: 'أسفل وسط', value: '50% 100%' },
  { label: 'أسفل يسار', value: '0% 100%' },
];

const DEFAULT_THEME_FALLBACK: ThemeConfig = {
  mode: 'auto',
  colors: {
    primary: '#D4AF37',
    secondary: '#94A3B8',
    accent: '#C5A880',
    background: '#0A0B0D',
    surface: '#121416',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    border: '#1E293B',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
  },
  radius: { sm: '6px', md: '10px', lg: '16px', xl: '24px', full: '9999px' },
  shadows: { sm: '0 1px 2px rgba(0,0,0,0.2)', md: '0 4px 12px rgba(0,0,0,0.3)', lg: '0 12px 32px rgba(0,0,0,0.4)' },
  typography: { fontFamily: 'tajawal', headingWeight: '700', bodyWeight: '400' },
  background: {
    light: { type: 'solid', color: '#FFFFFF', readabilityBoost: true },
    dark: { type: 'solid', color: '#0A0B0D', readabilityBoost: false },
  },
};

// ============================================================
// Theme save adapter — UI Theme Model → Server Theme Contract
// ============================================================
// The manager UI edits the CLIENT theme shape: `background.overlayColor`,
// `background.readabilityBoost`, string font weights, and `cards.shadow` as a
// shadow-scale key. The server's `PUT /manager/theme` validates with the
// STRICT `themeConfigSchema`: backgrounds use `overlay` + `readability`,
// weights are numeric, and `colors.card.shadow` is a raw CSS shadow resolved
// from the scale at save time. The per-component colour groups
// (`colors.button/card/badge/category`) are modelled identically on both
// sides and pass through verbatim.
// `toServerThemePayload` below is the SINGLE explicit conversion point between
// the two models (the reverse lives in `uiThemeConfigFromServer` in
// `services/api`). It whitelists every key it emits, so the strict schema
// never sees an unknown key, and every conversion is spelled out
// field-by-field — no blind spreading of the UI object into the request.

type ServerThemeFontKey = 'tajawal' | 'cairo' | 'amiri' | 'cormorant' | 'auto';
type ServerBackgroundType = 'solid' | 'gradient' | 'image' | 'image+overlay' | 'none';
type ServerBackgroundSize = 'cover' | 'contain' | 'auto';

interface ServerBackgroundPayload {
  type: ServerBackgroundType;
  color?: string;
  gradient?: string;
  image?: { storagePath: string; aiGenerated?: boolean };
  overlay?: string;
  overlayOpacity?: number;
  blur?: number;
  position?: string;
  size?: ServerBackgroundSize;
  readability?: { scrimOpacity?: number; textShadow?: boolean };
}

interface ServerThemePayload {
  mode?: ThemeMode;
  colors: ThemeColors;
  radius?: Partial<Record<'sm' | 'md' | 'lg' | 'xl' | 'full', string>>;
  shadows?: Partial<Record<'sm' | 'md' | 'lg', string>>;
  typography?: {
    fontFamily?: ServerThemeFontKey;
    headingWeight?: number;
    bodyWeight?: number;
  };
  background?: {
    light?: ServerBackgroundPayload;
    dark?: ServerBackgroundPayload;
  };
}

const SERVER_THEME_FONT_KEYS: readonly ServerThemeFontKey[] = ['tajawal', 'cairo', 'amiri', 'cormorant', 'auto'];
const SERVER_BACKGROUND_TYPES: readonly ServerBackgroundType[] = ['solid', 'gradient', 'image', 'image+overlay', 'none'];
const SERVER_BACKGROUND_SIZES: readonly ServerBackgroundSize[] = ['cover', 'contain', 'auto'];
// Mirrors the server's `overlayColor` validation (HEX, rgb()/rgba(), hsl()/hsla()).
const SERVER_OVERLAY_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$|^rgba?\(.+\)$|^hsla?\(.+\)$/i;
// Scrim used when the UI's `readabilityBoost` checkbox is converted to the
// server's `readability` object — matches the dark scrim CustomerLayout paints.
const THEME_READABILITY_SCRIM_OPACITY = 0.55;
const THEME_MAX_RADIUS_LENGTH = 20;
const THEME_MAX_SHADOW_LENGTH = 300;
const THEME_MAX_POSITION_LENGTH = 60;
const THEME_MAX_GRADIENT_LENGTH = 1000;
const THEME_MAX_STORAGE_PATH_LENGTH = 512;

/** Any parseable color (hex / rgb / rgba) → canonical `#RRGGBB`; otherwise the fallback. */
function normalizeThemeHexColor(value: unknown, fallback: string): string {
  const parsed = typeof value === 'string' ? parseColor(value) : null;
  return parsed ? rgbToHex(parsed) : fallback;
}

/** String/number font weight → integer clamped to the server's 100–900 range; invalid → omitted. */
function normalizeThemeFontWeight(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(900, Math.max(100, Math.round(numeric)));
}

/** Mirrors the server's tenant storage-path shape check (`restaurants/...`, no traversal/URLs). */
function isTenantThemeStoragePath(value: string): boolean {
  return (
    value.length <= THEME_MAX_STORAGE_PATH_LENGTH &&
    value.startsWith('restaurants/') &&
    !value.includes('..') &&
    !value.includes('\\') &&
    !value.includes('://') &&
    !value.includes('//')
  );
}

/**
 * Per-component colour groups (`colors.button/card/badge/category`) are
 * modelled identically on both sides and pass through VERBATIM — every field
 * is whitelisted here (hex-normalized where the schema expects a hex colour),
 * so values set through the API or an earlier save are never dropped on
 * re-save. Unparseable/overlong fields are omitted instead of sent.
 */
function copyGroupFields(
  src: unknown,
  hexFields: readonly string[],
  freeFields: readonly (readonly [string, number])[] = []
): Record<string, string> | undefined {
  if (!src || typeof src !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const f of hexFields) {
    const v = (src as Record<string, unknown>)[f];
    if (typeof v === 'string' && v.trim()) {
      const normalized = normalizeThemeHexColor(v, '');
      if (normalized) out[f] = normalized;
    }
  }
  for (const [f, maxLen] of freeFields) {
    const v = (src as Record<string, unknown>)[f];
    if (typeof v === 'string' && v.trim() && v.trim().length <= maxLen) out[f] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function colorGroupsToServer(uiColors: ThemeColors | undefined): Partial<Pick<ThemeColors, 'button' | 'card' | 'badge' | 'category'>> {
  if (!uiColors) return {};
  const out: Partial<Pick<ThemeColors, 'button' | 'card' | 'badge' | 'category'>> = {};
  const button = copyGroupFields(uiColors.button, ['primaryBg', 'primaryText', 'secondaryBg', 'secondaryText']);
  if (button) out.button = button;
  const card = copyGroupFields(uiColors.card, ['bg', 'border'], [['radius', THEME_MAX_RADIUS_LENGTH], ['shadow', THEME_MAX_SHADOW_LENGTH]]);
  if (card) out.card = card;
  const badge = copyGroupFields(uiColors.badge, ['bg', 'text']);
  if (badge) out.badge = badge;
  const category = copyGroupFields(uiColors.category, ['bg', 'text', 'activeBg', 'activeText']);
  if (category) out.category = category;
  return out;
}

/** One background variant (light/dark): UI field names → server field names. */
function backgroundConfigToServer(ui: BackgroundConfig | undefined): ServerBackgroundPayload | undefined {
  if (!ui) return undefined;
  const type = SERVER_BACKGROUND_TYPES.includes(ui.type as ServerBackgroundType)
    ? (ui.type as ServerBackgroundType)
    : undefined;
  if (!type) return undefined;

  const out: ServerBackgroundPayload = { type };

  // color — hex-normalized; dropped when not a real color (never sent raw).
  if (typeof ui.color === 'string' && ui.color.trim()) {
    const parsed = parseColor(ui.color);
    if (parsed) out.color = rgbToHex(parsed);
  }

  // gradient — free-form CSS, passed through bounded (server keeps final validation).
  if (typeof ui.gradient === 'string') {
    const gradient = ui.gradient.trim();
    if (gradient && gradient.length <= THEME_MAX_GRADIENT_LENGTH) out.gradient = gradient;
  }

  // image — only a valid tenant-scoped storage path is sent.
  if (ui.image && typeof ui.image.storagePath === 'string' && isTenantThemeStoragePath(ui.image.storagePath)) {
    out.image = { storagePath: ui.image.storagePath };
    if (typeof ui.image.aiGenerated === 'boolean') out.image.aiGenerated = ui.image.aiGenerated;
  }

  // overlayColor → overlay (name differs between the two contracts).
  if (typeof ui.overlayColor === 'string') {
    const overlay = ui.overlayColor.trim();
    if (overlay && SERVER_OVERLAY_COLOR_PATTERN.test(overlay)) out.overlay = overlay;
  }

  if (typeof ui.overlayOpacity === 'number' && Number.isFinite(ui.overlayOpacity)) {
    out.overlayOpacity = Math.min(1, Math.max(0, ui.overlayOpacity));
  }

  if (typeof ui.blur === 'number' && Number.isFinite(ui.blur)) {
    out.blur = Math.min(20, Math.max(0, ui.blur));
  }

  if (typeof ui.position === 'string') {
    const position = ui.position.trim();
    if (position && position.length <= THEME_MAX_POSITION_LENGTH) out.position = position;
  }

  if (SERVER_BACKGROUND_SIZES.includes(ui.size as ServerBackgroundSize)) {
    out.size = ui.size as ServerBackgroundSize;
  }

  // readabilityBoost → readability (server object shape). Reverse mapping in
  // mapEffectiveTheme treats a truthy scrimOpacity as the checked box.
  if (ui.readabilityBoost === true) {
    out.readability = { scrimOpacity: THEME_READABILITY_SCRIM_OPACITY };
  }

  return out;
}

/**
 * Convert the UI's edited ThemeConfig into the exact server contract accepted
 * by `PUT /manager/theme`. Legacy `primaryColor`/`accentColor` remain the
 * fallback for primary/accent exactly as the previous inline merge did.
 */
export function toServerThemePayload(
  ui: ThemeConfig,
  legacy: { primaryColor: string; accentColor: string }
): ServerThemePayload {
  const fallbackColors = DEFAULT_THEME_FALLBACK.colors!;
  const uiColors: Partial<NonNullable<ThemeConfig['colors']>> = ui.colors || {};

  const colors: ThemeColors = {
    primary: normalizeThemeHexColor(uiColors.primary, normalizeThemeHexColor(legacy.primaryColor, fallbackColors.primary)),
    secondary: normalizeThemeHexColor(uiColors.secondary, fallbackColors.secondary),
    accent: normalizeThemeHexColor(uiColors.accent, normalizeThemeHexColor(legacy.accentColor, fallbackColors.accent)),
    background: normalizeThemeHexColor(uiColors.background, fallbackColors.background),
    surface: normalizeThemeHexColor(uiColors.surface, fallbackColors.surface),
    textPrimary: normalizeThemeHexColor(uiColors.textPrimary, fallbackColors.textPrimary),
    textSecondary: normalizeThemeHexColor(uiColors.textSecondary, fallbackColors.textSecondary),
    border: normalizeThemeHexColor(uiColors.border, fallbackColors.border),
    success: normalizeThemeHexColor(uiColors.success, fallbackColors.success),
    warning: normalizeThemeHexColor(uiColors.warning, fallbackColors.warning),
    error: normalizeThemeHexColor(uiColors.error, fallbackColors.error),
  };

  // Per-component colour groups pass through verbatim (API-set values included).
  const groups = colorGroupsToServer(ui.colors);
  if (groups.button) colors.button = groups.button;
  if (groups.badge) colors.badge = groups.badge;
  if (groups.category) colors.category = groups.category;
  if (groups.card) colors.card = { ...groups.card };

  // Card radius/shadow overrides (the `cards` edit fields) win over the raw
  // group copy above: `cards.shadow` holds a shadows-scale key (or a raw CSS
  // shadow) and is resolved to the real CSS value here — the server slot
  // `colors.card.shadow` is a CSS shadow, never a bare key.
  if (ui.cards?.radius && typeof ui.cards.radius === 'string') {
    const radius = ui.cards.radius.trim();
    if (radius && radius.length <= THEME_MAX_RADIUS_LENGTH) {
      colors.card = { ...(colors.card || {}), radius };
    }
  }
  if (ui.cards?.shadow && typeof ui.cards.shadow === 'string') {
    const shadow = resolveThemeShadow(ui.cards.shadow, ui.shadows).trim();
    if (shadow && shadow.length <= THEME_MAX_SHADOW_LENGTH) {
      colors.card = { ...(colors.card || {}), shadow };
    }
  }

  const payload: ServerThemePayload = { colors };

  if (ui.mode === 'light' || ui.mode === 'dark' || ui.mode === 'auto') {
    payload.mode = ui.mode;
  }

  const RADIUS_KEYS = ['sm', 'md', 'lg', 'xl', 'full'] as const;
  if (ui.radius) {
    const radius: NonNullable<ServerThemePayload['radius']> = {};
    for (const key of RADIUS_KEYS) {
      const value = (ui.radius as unknown as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && trimmed.length <= THEME_MAX_RADIUS_LENGTH) radius[key] = trimmed;
      }
    }
    if (Object.keys(radius).length > 0) payload.radius = radius;
  }

  const SHADOW_KEYS = ['sm', 'md', 'lg'] as const;
  if (ui.shadows) {
    const shadows: NonNullable<ServerThemePayload['shadows']> = {};
    for (const key of SHADOW_KEYS) {
      const value = (ui.shadows as unknown as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && trimmed.length <= THEME_MAX_SHADOW_LENGTH) shadows[key] = trimmed;
      }
    }
    if (Object.keys(shadows).length > 0) payload.shadows = shadows;
  }

  if (ui.typography) {
    const typography: NonNullable<ServerThemePayload['typography']> = {};
    // Unsupported faces (the UI picker also offers inter/poppins) are never
    // sent — they are not part of the server contract.
    if (SERVER_THEME_FONT_KEYS.includes(ui.typography.fontFamily as ServerThemeFontKey)) {
      typography.fontFamily = ui.typography.fontFamily as ServerThemeFontKey;
    }
    const headingWeight = normalizeThemeFontWeight(ui.typography.headingWeight);
    if (headingWeight !== undefined) typography.headingWeight = headingWeight;
    const bodyWeight = normalizeThemeFontWeight(ui.typography.bodyWeight);
    if (bodyWeight !== undefined) typography.bodyWeight = bodyWeight;
    if (Object.keys(typography).length > 0) payload.typography = typography;
  }

  const light = backgroundConfigToServer(ui.background?.light);
  const dark = backgroundConfigToServer(ui.background?.dark);
  if (light || dark) {
    payload.background = {
      ...(light ? { light } : {}),
      ...(dark ? { dark } : {}),
    };
  }

  return payload;
}

export const BrandingSettingsView: React.FC = () => {
  const { currentRestaurant, setCurrentRestaurant, refreshTenantData, showToast, branches } = useRestaurant();

  // ==== Branding states (legacy) ====
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [mapImage, setMapImage] = useState('');
  const [logo, setLogo] = useState('');
  const [logoFit, setLogoFit] = useState<'cover' | 'contain'>('cover');
  const [logoPosition, setLogoPosition] = useState('50% 50%');
  const [coverImage, setCoverImage] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [accentColor, setAccentColor] = useState('#C5A880');
  const [businessType, setBusinessType] = useState<BusinessType>('RESTAURANT');
  const [promoVideoUrl, setPromoVideoUrl] = useState('');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [newGalleryUrl, setNewGalleryUrl] = useState('');
  const [transferBankName, setTransferBankName] = useState('');
  const [transferBankAccount, setTransferBankAccount] = useState('');
  const [transferBankAccountHolder, setTransferBankAccountHolder] = useState('');
  const [transferWalletName, setTransferWalletName] = useState('');
  const [transferWalletNumber, setTransferWalletNumber] = useState('');
  const [transferWalletAccountHolder, setTransferWalletAccountHolder] = useState('');
  const [transferInstructions, setTransferInstructions] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [uploadingMap, setUploadingMap] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
  const lastRestaurantIdRef = useRef<string>('');
  const lastCommittedRestaurantRef = useRef<string>('');
  const isDirtyRef = useRef<boolean>(false);

  // ==== New Theme Management states ====
  const [activeTab, setActiveTab] = useState<'branding' | 'theme' | 'background' | 'advanced'>('branding');
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme | null>(null);
  const [storedTheme, setStoredTheme] = useState<ThemeRow | null>(null);
  const [themeLoading, setThemeLoading] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [editConfig, setEditConfig] = useState<ThemeConfig>(DEFAULT_THEME_FALLBACK);
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'tablet' | 'desktop'>('mobile');
  const [bgUploading, setBgUploading] = useState<'light' | 'dark' | null>(null);
  const bgLightInputRef = useRef<HTMLInputElement>(null);
  const bgDarkInputRef = useRef<HTMLInputElement>(null);

  // Load branding from restaurant
  useEffect(() => {
    if (currentRestaurant) {
      const isDifferentTenant = lastRestaurantIdRef.current !== currentRestaurant.id;
      if (!isDifferentTenant && isDirtyRef.current) return;
      const restaurantKey = `${currentRestaurant.id}-${currentRestaurant.updatedAt || ''}-${currentRestaurant.logo}-${currentRestaurant.coverImage}-${currentRestaurant.name}`;
      if (lastCommittedRestaurantRef.current === restaurantKey) return;
      lastCommittedRestaurantRef.current = restaurantKey;
      lastRestaurantIdRef.current = currentRestaurant.id;
      isDirtyRef.current = false;

      setName(currentRestaurant.name);
      setNameEn(currentRestaurant.nameEn);
      setDescription(currentRestaurant.description);
      setPhone(currentRestaurant.phone);
      setAddress(currentRestaurant.address);
      setMapImage(currentRestaurant.mapImageUrl || '');
      setLogo(currentRestaurant.logo);
      setLogoFit(currentRestaurant.logoFit === 'contain' ? 'contain' : 'cover');
      setLogoPosition(currentRestaurant.logoPosition || '50% 50%');
      setCoverImage(currentRestaurant.coverImage || '');
      const prim = currentRestaurant.primaryColor || '#D4AF37';
      const acc = currentRestaurant.accentColor || '#C5A880';
      setPrimaryColor(prim);
      setAccentColor(acc);
      const matched = THEME_PRESETS.find((p) => p.primary.toLowerCase() === prim.toLowerCase() && p.accent.toLowerCase() === acc.toLowerCase());
      if (matched) setActivePreset(matched.id);
      else {
        const cached = getCachedBrandTheme();
        if (cached?.presetId) setActivePreset(cached.presetId);
      }
      setBusinessType(currentRestaurant.businessType || 'RESTAURANT');
      setPromoVideoUrl(currentRestaurant.promoVideoUrl || '');
      setGalleryImages(currentRestaurant.galleryImages || []);
      setTransferBankName(currentRestaurant.transfer?.bankName || '');
      setTransferBankAccount(currentRestaurant.transfer?.bankAccount || '');
      setTransferBankAccountHolder(currentRestaurant.transfer?.bankAccountHolder || '');
      setTransferWalletName(currentRestaurant.transfer?.walletName || '');
      setTransferWalletNumber(currentRestaurant.transfer?.walletNumber || '');
      setTransferWalletAccountHolder(currentRestaurant.transfer?.walletAccountHolder || '');
      setTransferInstructions(currentRestaurant.transfer?.instructions || '');
      setWhatsappNumber(currentRestaurant.whatsappNumber || '');
      setInstagramUrl(currentRestaurant.socials?.instagram || '');
      setFacebookUrl(currentRestaurant.socials?.facebook || '');
      setTiktokUrl(currentRestaurant.socials?.tiktok || '');
      setYoutubeUrl(currentRestaurant.socials?.youtube || '');
      setWebsiteUrl(currentRestaurant.socials?.website || '');
      if (currentRestaurant.theme) {
        setEffectiveTheme(currentRestaurant.theme);
        setEditConfig(currentRestaurant.theme.rawConfig || DEFAULT_THEME_FALLBACK);
      }
    }
  }, [currentRestaurant]);

  // Fetch theme for selected scope
  const fetchTheme = async (branchId: string | null) => {
    if (!currentRestaurant) return;
    setThemeLoading(true);
    try {
      const res = await api.getTheme(currentRestaurant.id, branchId);
      if (res.success && res.data) {
        setEffectiveTheme(res.data.effective);
        setStoredTheme(res.data.stored);
        // Hydrate the edit model from the resolved raw config (already in the
        // UI shape via mapEffectiveTheme). A raw stored row is converted
        // through the reverse adapter first — it lives in the server contract.
        setEditConfig(
          res.data.effective.rawConfig ||
            (res.data.stored?.config ? uiThemeConfigFromServer(res.data.stored.config) : undefined) ||
            DEFAULT_THEME_FALLBACK
        );
      }
    } catch {
      // ignore
    } finally {
      setThemeLoading(false);
    }
  };

  useEffect(() => {
    fetchTheme(selectedBranchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, currentRestaurant?.id]);

  const applyPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setPrimaryColor(preset.primary);
    setAccentColor(preset.accent);
    setActivePreset(presetId);
    applyBrandTheme(preset.primary, preset.accent, null, { presetId, restaurantId: currentRestaurant?.id, slug: currentRestaurant?.slug });
    // Also update theme config
    setEditConfig((prev) => ({
      ...prev,
      colors: { ...(prev.colors || DEFAULT_THEME_FALLBACK.colors!), primary: preset.primary, secondary: prev.colors?.secondary || '#94A3B8', accent: preset.accent, background: prev.colors?.background || '#0A0B0D', surface: prev.colors?.surface || '#121416', textPrimary: prev.colors?.textPrimary || '#F8FAFC', textSecondary: prev.colors?.textSecondary || '#94A3B8', border: prev.colors?.border || '#1E293B', success: prev.colors?.success || '#10B981', warning: prev.colors?.warning || '#F59E0B', error: prev.colors?.error || '#EF4444' },
    }));
  };

  const handleUpload = async (kind: 'logo' | 'cover', file?: File) => {
    if (!file || !currentRestaurant) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'صيغة غير مدعومة', 'يرجى اختيار صورة JPG أو PNG أو WEBP');
      return;
    }
    setUploading(kind);
    try {
      const { blob, ext } = await optimizeImageFile(file, kind);
      const res = await api.uploadImage(blob, `brand-${kind}-${Date.now()}.${ext}`, kind, currentRestaurant.id);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع الصورة إلى الخادم', res.error);
        return;
      }
      if (kind === 'logo') setLogo(res.data.url);
      else setCoverImage(res.data.url);
      showToast('success', 'تم رفع الصورة', kind === 'logo' ? 'تم تحديث شعار المطعم — احفظ للتطبيق' : 'تم تحديث صورة الغلاف — احفظ للتطبيق');
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف أو ضغطه');
    } finally {
      setUploading(null);
      if (logoInputRef.current) logoInputRef.current.value = '';
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleAddGalleryImage = () => {
    if (!newGalleryUrl.trim()) return;
    setGalleryImages((prev) => [...prev, newGalleryUrl.trim()]);
    setNewGalleryUrl('');
  };
  const handleRemoveGalleryImage = (index: number) => setGalleryImages((prev) => prev.filter((_, i) => i !== index));
  const handleUploadGalleryFile = async (file?: File) => {
    if (!file || !currentRestaurant) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'صيغة غير مدعومة', 'يرجى اختيار صورة JPG أو PNG أو WEBP');
      return;
    }
    setUploadingGallery(true);
    try {
      const { blob, ext } = await optimizeImageFile(file, 'gallery');
      const res = await api.uploadImage(blob, `hall-gallery-${Date.now()}.${ext}`, 'gallery', currentRestaurant.id);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع الصورة', res.error);
        return;
      }
      setGalleryImages((prev) => [...prev, res.data.url]);
      showToast('success', 'تم إضافة الصورة لمعرض الصالة', 'احفظ التعديلات لتنعكس على المنيو');
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف');
    } finally {
      setUploadingGallery(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };
  const handleUploadMap = async (file?: File) => {
    if (!file || !currentRestaurant) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'صيغة غير مدعومة', 'يرجى اختيار صورة JPG أو PNG أو WEBP');
      return;
    }
    setUploadingMap(true);
    try {
      const { blob, ext } = await optimizeImageFile(file, 'map');
      const res = await api.uploadImage(blob, `map-${Date.now()}.${ext}`, 'map', currentRestaurant.id);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع صورة الخريطة', res.error);
        return;
      }
      setMapImage(res.data.url);
      showToast('success', 'تم رفع صورة الخريطة', 'احفظ التعديلات لتظهر خريطة موقعك للعملاء');
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف');
    } finally {
      setUploadingMap(false);
      if (mapInputRef.current) mapInputRef.current.value = '';
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!currentRestaurant || isSaving) return;
    if (isEmbeddedImage(logo) || isEmbeddedImage(coverImage) || galleryImages.some((u) => isEmbeddedImage(u))) {
      showToast('error', 'تعذر حفظ الهوية البصرية', 'إحدى الصور مخزنة كنص ثقيل (base64) — أعد رفعها عبر أزرار الرفع من جهازك ثم اضغط حفظ مجدداً');
      return;
    }
    setIsSaving(true);
    const res = await api.saveBranding(currentRestaurant.id, {
      name: name.trim(),
      nameEn: nameEn.trim(),
      description: description.trim(),
      phone: phone.trim(),
      address: address.trim(),
      mapImageUrl: mapImage.trim(),
      logo: logo.trim(),
      logoFit,
      logoPosition,
      coverImage: coverImage.trim(),
      primaryColor,
      accentColor,
      businessType,
      promoVideoUrl: promoVideoUrl.trim(),
      galleryImages,
      transfer: {
        bankName: transferBankName.trim(),
        bankAccount: transferBankAccount.trim(),
        bankAccountHolder: transferBankAccountHolder.trim(),
        walletName: transferWalletName.trim(),
        walletNumber: transferWalletNumber.trim(),
        walletAccountHolder: transferWalletAccountHolder.trim(),
        instructions: transferInstructions.trim(),
      },
      whatsappNumber: whatsappNumber.trim(),
      socials: {
        instagram: instagramUrl.trim(),
        facebook: facebookUrl.trim(),
        tiktok: tiktokUrl.trim(),
        youtube: youtubeUrl.trim(),
        website: websiteUrl.trim(),
      },
    });
    setIsSaving(false);
    if (!res.success || !res.data) {
      showToast('error', 'تعذر حفظ الهوية البصرية', res.error || 'يرجى المحاولة لاحقاً');
      return;
    }
    isDirtyRef.current = false;
    lastRestaurantIdRef.current = res.data.restaurant.id;
    lastCommittedRestaurantRef.current = `${res.data.restaurant.id}-${res.data.restaurant.updatedAt || ''}-${res.data.restaurant.logo}-${res.data.restaurant.coverImage}-${res.data.restaurant.name}`;
    setCurrentRestaurant(res.data.restaurant);
    applyBrandTheme(res.data.restaurant.primaryColor, res.data.restaurant.accentColor, null, {
      presetId: activePreset || undefined,
      restaurantId: res.data.restaurant.id,
      slug: res.data.restaurant.slug,
    });
    refreshTenantData();
    showToast('success', 'تم حفظ إعدادات الهوية بنجاح', 'تم تثبيت وتطبيق ألوان الـ Theme والشعار والمعرض مباشرة عبر النظام.');
  };

  // ==== Theme Save ====
  const handleSaveTheme = async () => {
    if (!currentRestaurant) return;
    setThemeSaving(true);
    try {
      // Explicit UI → server-contract normalization (single choke point):
      // whitelists every emitted key, maps overlayColor→overlay,
      // readabilityBoost→readability, style groups→colors.button/card/…,
      // string weights→numbers, and keeps legacy primary/accent as the
      // primary/accent fallback exactly like the previous inline merge.
      const serverConfig = toServerThemePayload(editConfig, { primaryColor, accentColor });
      const res = await api.upsertTheme(
        currentRestaurant.id,
        // The client ThemeConfig type predates the server's nested style
        // groups; the adapter output above follows the server contract and is
        // validated by themeConfigSchema on PUT /manager/theme.
        serverConfig as unknown as ThemeConfig,
        selectedBranchId
      );
      if (!res.success || !res.data) {
        showToast('error', 'تعذر حفظ الثيم', (res as any).error || 'حاول مجدداً');
        return;
      }
      setEffectiveTheme(res.data.effective);
      setStoredTheme(res.data.theme);
      // Update currentRestaurant theme for live preview
      setCurrentRestaurant({ ...currentRestaurant, theme: res.data.effective } as any);
      showToast('success', 'تم حفظ الثيم', selectedBranchId ? 'تم تطبيق الثيم على الفرع المحدد' : 'تم تطبيق الثيم على مستوى المطعم');
    } finally {
      setThemeSaving(false);
    }
  };

  const handleResetTheme = async () => {
    if (!currentRestaurant) return;
    setThemeSaving(true);
    try {
      const res = await api.deleteTheme(currentRestaurant.id, selectedBranchId);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر إعادة التعيين', (res as any).error);
        return;
      }
      setEffectiveTheme(res.data.effective);
      setEditConfig(res.data.effective.rawConfig);
      setStoredTheme(null);
      setCurrentRestaurant({ ...currentRestaurant, theme: res.data.effective } as any);
      showToast('success', 'تمت إعادة التعيين', 'تم الرجوع للثيم الافتراضي (Platform → Restaurant → Branch)');
    } finally {
      setThemeSaving(false);
    }
  };

  const handleBgUpload = async (variant: 'light' | 'dark', file?: File) => {
    if (!file || !currentRestaurant) return;
    setBgUploading(variant);
    try {
      const { blob, ext } = await optimizeImageFile(file, 'cover');
      const res = await api.uploadImage(blob, `bg-${variant}-${Date.now()}.${ext}`, 'cover', currentRestaurant.id);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع خلفية المنيو', res.error);
        return;
      }
      // Update editConfig background
      setEditConfig((prev) => {
        const currentBg = prev.background?.[variant] || { type: 'image' as BackgroundType };
        return {
          ...prev,
          background: {
            ...(prev.background || {}),
            [variant]: {
              ...currentBg,
              type: currentBg.type === 'solid' || currentBg.type === 'gradient' ? 'image' as BackgroundType : currentBg.type || 'image',
              image: { storagePath: (res.data as any).storagePath || (res.data as any).key || res.data.url, aiGenerated: false },
            },
          },
        };
      });
      showToast('success', 'تم رفع الخلفية', `خلفية ${variant === 'light' ? 'الوضع الفاتح' : 'الداكن'} جاهزة — احفظ الثيم`);
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف');
    } finally {
      setBgUploading(null);
    }
  };

  // Live preview vars
  const previewVars = useMemo(() => {
    if (!effectiveTheme) return {};
    // Build vars from editConfig merged with effective for preview
    const tempEffective: EffectiveTheme = {
      ...(effectiveTheme as EffectiveTheme),
      ...{ rawConfig: editConfig },
      colors: { ...(effectiveTheme.colors), ...(editConfig.colors || {}) } as any,
      background: {
        light: {
          ...(effectiveTheme.background.light),
          ...(editConfig.background?.light ? { type: editConfig.background.light.type, color: editConfig.background.light.color, gradient: editConfig.background.light.gradient, overlayColor: editConfig.background.light.overlayColor, overlayOpacity: editConfig.background.light.overlayOpacity, blur: editConfig.background.light.blur, position: editConfig.background.light.position, size: editConfig.background.light.size, readabilityBoost: editConfig.background.light.readabilityBoost } as any : {}),
        } as any,
        dark: {
          ...(effectiveTheme.background.dark),
          ...(editConfig.background?.dark ? { type: editConfig.background.dark.type, color: editConfig.background.dark.color, gradient: editConfig.background.dark.gradient, overlayColor: editConfig.background.dark.overlayColor, overlayOpacity: editConfig.background.dark.overlayOpacity, blur: editConfig.background.dark.blur, position: editConfig.background.dark.position, size: editConfig.background.dark.size, readabilityBoost: editConfig.background.dark.readabilityBoost } as any : {}),
        } as any,
      },
    } as any;
    // Simplified: use buildEffectiveThemeVars if available, else manual
    try {
      return buildEffectiveThemeVars(tempEffective as any);
    } catch {
      return {};
    }
  }, [effectiveTheme, editConfig]);

  const currency = currentRestaurant?.currency || '₪';
  const logoPreview = logo || currentRestaurant?.logo || '';

  const hasLegacyEmbeddedImages = isEmbeddedImage(logoPreview) || isEmbeddedImage(coverImage) || galleryImages.some((u) => isEmbeddedImage(u));

  const socialValues = { instagramUrl, facebookUrl, tiktokUrl, youtubeUrl, websiteUrl } as const;
  const socialSetters = { instagramUrl: setInstagramUrl, facebookUrl: setFacebookUrl, tiktokUrl: setTiktokUrl, youtubeUrl: setYoutubeUrl, websiteUrl: setWebsiteUrl } as const;

  if (!currentRestaurant) return null;

  const currentBgLight: BackgroundConfig = editConfig.background?.light || { type: 'solid', color: '#FFFFFF' };
  const currentBgDark: BackgroundConfig = editConfig.background?.dark || { type: 'solid', color: '#0A0B0D' };

  return (
    <div className="space-y-6 text-right max-w-7xl" dir="rtl">
      {/* Header with branch selector and inheritance info */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Palette className="w-5 h-5 text-gold-400" />
            <span>هوية وثيم مطعمك — نظام مركزي</span>
            {effectiveTheme && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-luxury-800 border border-luxury-700 text-luxury-300 flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {effectiveTheme.source === 'branch' ? 'فرع' : effectiveTheme.source === 'restaurant' ? 'مطعم' : effectiveTheme.source === 'platform' ? 'منصة' : 'افتراضي'}
              </span>
            )}
          </h2>
          <p className="text-xs text-luxury-400">
            تحكم كامل بمظهر المنيو: Light/Dark/Auto، ألوان، خلفية احترافية، خطوط، أزرار، بطاقات — مع وراثة Platform → Restaurant → Branch
          </p>

        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Branch selector */}
          <div className="flex items-center gap-2 bg-luxury-950 border border-luxury-800 rounded-xl px-3 py-2">
            <span className="text-[11px] text-luxury-400">النطاق:</span>
            <select
              value={selectedBranchId || ''}
              onChange={(e) => setSelectedBranchId(e.target.value || null)}
              className="bg-luxury-900 border border-luxury-800 rounded-lg px-2 py-1 text-xs text-luxury-100"
            >
              <option value="">المطعم (كل الفروع)</option>
              {(branches || []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <button onClick={handleSaveTheme} disabled={themeSaving || themeLoading} className="px-4 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 disabled:opacity-60">
            {themeSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>حفظ الثيم {selectedBranchId ? '(فرع)' : '(مطعم)'}</span>
          </button>

          <button onClick={handleResetTheme} disabled={themeSaving} className="px-3 py-2.5 rounded-xl bg-luxury-800 hover:bg-luxury-700 border border-luxury-700 text-luxury-200 text-xs flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4" />
            إعادة تعيين
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 p-1 bg-luxury-900 border border-luxury-800 rounded-2xl w-fit">
        {[
          { id: 'theme', label: 'الثيم المركزي', icon: Palette },
          { id: 'background', label: 'خلفية المنيو', icon: ImageIcon },
          { id: 'branding', label: 'الهوية والشعار', icon: Star },
          { id: 'advanced', label: 'متقدم ونسخ', icon: Layers },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${active ? 'bg-gold-500 text-luxury-950 shadow-gold-glow' : 'text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800'}`}>
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {hasLegacyEmbeddedImages && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-xs leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-amber-200"><span className="font-bold">تنبيه: بعض الصور مخزنة بالصيغة القديمة الثقيلة</span> ولن يكتمل الحفظ قبل معالجتها — أعد رفع الشعار / الغلاف / صور الصالة عبر أزرار الرفع.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Left: Editors */}
        <div className="lg:col-span-3 space-y-6">

          {activeTab === 'theme' && (
            <>
              {/* Mode — selects which background configuration (light/dark)
                  paints the menu; `auto` follows the guest's device setting.
                  The palette itself is single-valued (no dark re-mapping), so
                  the copy below states exactly that. */}
              <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-5 space-y-4">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><Sun className="w-4 h-4 text-gold-400" /> وضع الثيم</h3>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'light', label: 'فاتح', icon: Sun },
                    { id: 'dark', label: 'داكن', icon: Moon },
                    { id: 'auto', label: 'تلقائي', icon: Monitor },
                  ].map((m) => {
                    const Icon = m.icon;
                    const sel = (editConfig.mode || 'auto') === m.id;
                    return (
                      <button key={m.id} onClick={() => setEditConfig((p) => ({ ...p, mode: m.id as ThemeMode }))} className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 ${sel ? 'bg-gold-500/15 border-gold-500/60 text-gold-300' : 'bg-luxury-950 border-luxury-800 text-luxury-400'}`}>
                        <Icon className="w-5 h-5" /> {m.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-luxury-400 leading-relaxed">الوضع يحدد خلفية القائمة (فاتح/داكن) — «تلقائي» يتبع إعداد الجهاز. ألوان الهوية تُطبق كما هي في كلتا الحالتين.</p>
              </div>

              {/* Colors */}
              <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-5 space-y-4">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><Palette className="w-4 h-4 text-gold-400" /> الألوان الأساسية والثانوية</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { key: 'primary', label: 'أساسي' },
                    { key: 'secondary', label: 'ثانوي' },
                    { key: 'accent', label: 'مميز' },
                    { key: 'background', label: 'خلفية' },
                    { key: 'surface', label: 'سطح' },
                    { key: 'textPrimary', label: 'نص أساسي' },
                    { key: 'textSecondary', label: 'نص ثانوي' },
                    { key: 'border', label: 'حدود' },
                    { key: 'success', label: 'نجاح' },
                    { key: 'warning', label: 'تحذير' },
                    { key: 'error', label: 'خطأ' },
                  ] .map((c) => {
                    const val = (editConfig.colors as any)?.[c.key] || (DEFAULT_THEME_FALLBACK.colors as any)[c.key];
                    return (
                      <div key={c.key} className="bg-luxury-950 border border-luxury-800 rounded-xl p-2.5 space-y-1.5">
                        <span className="text-[11px] text-luxury-300 font-bold">{c.label}</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={val} onChange={(e) => setEditConfig((p) => ({ ...p, colors: { ...(p.colors || DEFAULT_THEME_FALLBACK.colors!), [c.key]: e.target.value } as any }))} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
                          <span className="font-mono text-[10px] text-luxury-400" dir="ltr">{val}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Presets */}
                <div className="pt-3 border-t border-luxury-800">
                  <span className="text-xs font-bold text-luxury-200 flex items-center gap-1"><Wand2 className="w-3.5 h-3.5 text-gold-400" /> ثيمات جاهزة</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    {THEME_PRESETS.map((preset) => (
                      <button key={preset.id} onClick={() => applyPreset(preset.id)} className={`p-2.5 rounded-xl border text-right ${activePreset === preset.id ? 'border-gold-500 bg-gold-500/10' : 'border-luxury-800 bg-luxury-950'}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="w-5 h-5 rounded-lg" style={{ background: `linear-gradient(135deg, ${preset.primary}, ${preset.accent})` }} />
                          <span className="text-[11px] font-bold text-luxury-100">{preset.label}</span>
                        </div>
                        <span className="text-[10px] text-luxury-500">{preset.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Typography & Radius & Shadows */}
              <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-5 space-y-5">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><Type className="w-4 h-4 text-gold-400" /> الخطوط والزوايا والظلال</h3>

                <div>
                  <span className="text-xs font-bold text-luxury-300">الخط</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    {FONT_OPTIONS.map((f) => {
                      const sel = (editConfig.typography?.fontFamily || 'tajawal') === f.id;
                      return (
                        <button key={f.id} onClick={() => setEditConfig((p) => ({ ...p, typography: { ...(p.typography || DEFAULT_THEME_FALLBACK.typography!), fontFamily: f.id } }))} className={`p-2.5 rounded-xl border text-xs ${sel ? 'bg-gold-500/15 border-gold-500/60 text-gold-300' : 'bg-luxury-950 border-luxury-800 text-luxury-400'}`} style={{ fontFamily: f.family }}>
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs font-bold text-luxury-300">نصف القطر (Radius)</span>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {(['sm', 'md', 'lg', 'xl'] as const).map((k) => (
                        <div key={k} className="bg-luxury-950 border border-luxury-800 rounded-xl p-2">
                          <span className="text-[10px] text-luxury-400">{k}</span>
                          <input type="text" value={(editConfig.radius as any)?.[k] || (DEFAULT_THEME_FALLBACK.radius as any)[k]} onChange={(e) => setEditConfig((p) => ({ ...p, radius: { ...(p.radius || DEFAULT_THEME_FALLBACK.radius!), [k]: e.target.value } as any }))} className="w-full bg-luxury-900 border border-luxury-800 rounded-lg p-1.5 text-[11px] font-mono text-luxury-100 mt-1" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-luxury-300">الظلال</span>
                    <div className="space-y-2 mt-2">
                      {(['sm', 'md', 'lg'] as const).map((k) => (
                        <div key={k} className="bg-luxury-950 border border-luxury-800 rounded-xl p-2">
                          <span className="text-[10px] text-luxury-400">{k}</span>
                          <input type="text" value={(editConfig.shadows as any)?.[k] || (DEFAULT_THEME_FALLBACK.shadows as any)[k]} onChange={(e) => setEditConfig((p) => ({ ...p, shadows: { ...(p.shadows || DEFAULT_THEME_FALLBACK.shadows!), [k]: e.target.value } as any }))} className="w-full bg-luxury-900 border border-luxury-800 rounded-lg p-1.5 text-[10px] font-mono text-luxury-100 mt-1" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Card shadow — persisted as `colors.card.shadow` (resolved
                    from the shadows scale at save time). Controls whose state
                    has no persistence model (button/badge/category visual
                    variants) were removed so the editor only offers what the
                    Theme system can actually store. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-luxury-800">
                  <div>
                    <span className="text-xs font-bold text-luxury-300">ظل البطاقات</span>
                    <select
                      value={themeShadowKey(editConfig.cards?.shadow, editConfig.shadows) || 'md'}
                      onChange={(e) => setEditConfig((p) => ({ ...p, cards: { ...(p.cards || {}), shadow: e.target.value as 'sm' | 'md' | 'lg' } }))}
                      className="w-full mt-1 bg-luxury-950 border border-luxury-800 rounded-lg p-2 text-xs text-luxury-100"
                    >
                      <option value="sm">ظل صغير</option>
                      <option value="md">ظل متوسط</option>
                      <option value="lg">ظل كبير</option>
                    </select>
                    <p className="mt-1.5 text-[10px] text-luxury-500">يعتمد على سلّم الظلال أعلاه — يُحفظ كقيمة CSS فعلية.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'background' && (
            <>
              {/* Background Light */}
              {(['light', 'dark'] as const).map((variant) => {
                const cfg = variant === 'light' ? currentBgLight : currentBgDark;
                return (
                  <div key={variant} className="bg-luxury-900 border border-luxury-800 rounded-2xl p-5 space-y-4">
                    <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2">
                      {variant === 'light' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
                      خلفية {variant === 'light' ? 'الوضع الفاتح' : 'الداكن'}
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {BG_TYPES.map((t) => {
                        const sel = cfg.type === t.id;
                        return (
                          <button key={t.id}  onClick={() => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), type: t.id } as any } }))} className={`p-2.5 rounded-xl border text-xs font-bold ${sel ? 'bg-gold-500/15 border-gold-500/60 text-gold-300' : 'bg-luxury-950 border-luxury-800 text-luxury-400'}`}>
                            {t.label}
                          </button>
                        );
                      })}
                    </div>

                    {(cfg.type === 'solid' || cfg.type === 'image+overlay') && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-luxury-300">لون ثابت</span>
                        <input type="color" value={cfg.color || '#0A0B0D'}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), color: e.target.value } as any } }))} className="w-9 h-9 rounded bg-transparent border-0" />
                        <input type="text" value={cfg.color || ''}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), color: e.target.value } as any } }))} className="flex-1 bg-luxury-950 border border-luxury-800 rounded-xl p-2 text-xs font-mono text-luxury-100" placeholder="#0A0B0D" />
                      </div>
                    )}

                    {cfg.type === 'gradient' && (
                      <div>
                        <span className="text-xs text-luxury-300">تدرج CSS</span>
                        <input type="text" value={cfg.gradient || ''}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), gradient: e.target.value } as any } }))} className="w-full mt-1 bg-luxury-950 border border-luxury-800 rounded-xl p-2.5 text-xs font-mono text-luxury-100" placeholder="linear-gradient(135deg, #0A0B0D, #1E293B)" />
                      </div>
                    )}

                    {(cfg.type === 'image' || cfg.type === 'image+overlay') && (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-luxury-300">صورة الخلفية</span>
                            <span className="text-[10px] text-luxury-500">رفع / مكتبة المطعم / AI</span>
                          </div>
                          <div className="flex gap-2">
                            <input ref={variant === 'light' ? bgLightInputRef : bgDarkInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => handleBgUpload(variant, e.target.files?.[0])} />
                            <button disabled={bgUploading === variant} onClick={() => (variant === 'light' ? bgLightInputRef.current?.click() : bgDarkInputRef.current?.click())} className="px-3 py-2 rounded-xl bg-luxury-800 hover:bg-luxury-700 border border-luxury-700 text-luxury-100 text-xs flex items-center gap-1.5 disabled:opacity-60">
                              {bgUploading === variant ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} رفع صورة
                            </button>
                            <button  onClick={() => { if (coverImage) setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), image: { storagePath: coverImage } } as any } })); }} className="px-3 py-2 rounded-xl bg-luxury-950 border border-luxury-800 text-luxury-300 text-xs">من مكتبة المطعم</button>
                            <span className="px-3 py-2 rounded-xl bg-luxury-950 border border-dashed border-luxury-700 text-luxury-500 text-xs flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI قريباً</span>
                          </div>
                          {cfg.image && <span className="text-[10px] text-luxury-400 font-mono truncate block">{cfg.image.storagePath}</span>}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-[11px] text-luxury-400">الموضع</span>
                            <select value={cfg.position || 'center'}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), position: e.target.value as any } as any } }))} className="w-full mt-1 bg-luxury-950 border border-luxury-800 rounded-lg p-2 text-xs text-luxury-100">
                              <option value="center">وسط</option><option value="top">أعلى</option><option value="bottom">أسفل</option><option value="left">يسار</option><option value="right">يمين</option>
                            </select>
                          </div>
                          <div>
                            <span className="text-[11px] text-luxury-400">الحجم</span>
                            <select value={cfg.size || 'cover'}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), size: e.target.value as any } as any } }))} className="w-full mt-1 bg-luxury-950 border border-luxury-800 rounded-lg p-2 text-xs text-luxury-100">
                              <option value="cover">تغطية</option><option value="contain">احتواء</option><option value="auto">تلقائي</option>
                            </select>
                          </div>
                        </div>

                        {cfg.type === 'image+overlay' && (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <span className="text-[11px] text-luxury-400">لون Overlay</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <input type="color" value={cfg.overlayColor?.startsWith('#') ? cfg.overlayColor : '#000000'}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), overlayColor: e.target.value } as any } }))} className="w-8 h-8 rounded bg-transparent border-0" />
                                  <input type="text" value={cfg.overlayColor || ''}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), overlayColor: e.target.value } as any } }))} className="flex-1 bg-luxury-950 border border-luxury-800 rounded-lg p-1.5 text-xs font-mono text-luxury-100" placeholder="rgba(0,0,0,0.6)" />
                                </div>
                              </div>
                              <div>
                                <span className="text-[11px] text-luxury-400">شفافية Overlay: {cfg.overlayOpacity ?? 0.85}</span>
                                <input type="range" min={0} max={1} step={0.05} value={cfg.overlayOpacity ?? 0.85}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), overlayOpacity: parseFloat(e.target.value) } as any } }))} className="w-full mt-1" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <span className="text-[11px] text-luxury-400">Blur: {cfg.blur || 0}px</span>
                                <input type="range" min={0} max={20} step={1} value={cfg.blur || 0}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), blur: parseInt(e.target.value) } as any } }))} className="w-full mt-1" />
                              </div>
                              <label className="flex items-center gap-2 text-xs text-luxury-300 mt-6">
                                <input type="checkbox" checked={!!cfg.readabilityBoost}  onChange={(e) => setEditConfig((p) => ({ ...p, background: { ...(p.background || {}), [variant]: { ...(p.background?.[variant] || {}), readabilityBoost: e.target.checked } as any } }))} />
                                تحسين قابلية القراءة
                              </label>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {activeTab === 'branding' && (
            <>
              <form onSubmit={handleSave} onInput={() => { isDirtyRef.current = true; }} className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 shadow-luxury space-y-5 text-xs">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><UtensilsCrossed className="w-4 h-4 text-gold-400" /> بيانات المطعم الأساسية</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="block font-bold text-luxury-200 mb-1">اسم المطعم (بالعربية)</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl" /></div>
                  <div><label className="block font-bold text-luxury-200 mb-1">الاسم بالإنجليزية</label><input type="text" value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl" /></div>
                </div>
                <div><label className="block font-bold text-luxury-200 mb-1">الوصف</label><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl resize-none" /></div>
                <div><span className="block font-bold text-luxury-200 mb-1.5">نوع النشاط</span><div role="radiogroup" className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">{BUSINESS_TYPES.map((type) => { const Icon = type.icon; const selected = businessType === type.id; return (<button key={type.id} type="button" role="radio" aria-checked={selected} onClick={() => setBusinessType(type.id)} className={`p-3 rounded-xl border text-right transition-all flex items-start gap-2.5 cursor-pointer ${selected ? 'bg-luxury-800 border-gold-500/70' : 'bg-luxury-950 border-luxury-800'}`}><Icon className={`w-5 h-5 mt-0.5 shrink-0 ${selected ? 'text-gold-400' : 'text-luxury-400'}`} /><span><span className="block text-luxury-100 font-bold text-sm">{type.label}</span><span className="block text-[10px] text-luxury-400">{type.desc}</span></span>{selected && <Check className="w-4 h-4 text-gold-400 mr-auto" />}</button>); })}</div></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-gold-400" /> رقم الهاتف</label><input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl" /></div>
                  <div><label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-gold-400" /> العنوان</label><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl" placeholder="مثال: شارع الإرسال، رام الله" /></div>
                </div>
                <div className="pt-2 border-t border-luxury-850 space-y-3">
                  <div className="flex items-center justify-between"><label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-gold-400" /> صورة الخريطة</label><span className="text-[10px] text-luxury-500">اختياري</span></div>
                  <div className="h-36 rounded-xl overflow-hidden border border-luxury-700 bg-luxury-900 flex items-center justify-center">{mapImage ? <img src={mapImage} alt="خريطة" className="w-full h-full object-cover" /> : <span className="text-[10px] text-luxury-500">لا توجد صورة خريطة</span>}</div>
                  <div className="space-y-2"><input ref={mapInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => handleUploadMap(e.target.files?.[0])} /><button type="button" onClick={() => mapInputRef.current?.click()} disabled={uploadingMap} className="w-full py-2 rounded-xl bg-luxury-850 border border-luxury-700 text-luxury-100 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60">{uploadingMap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-gold-400" />}{uploadingMap ? 'جاري رفع الخريطة...' : mapImage ? 'استبدال الخريطة' : 'رفع خريطة'}</button>{mapImage && <button type="button" onClick={() => setMapImage('')} className="w-full py-2 rounded-xl bg-luxury-900 border border-luxury-700 text-luxury-400 text-xs flex items-center justify-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> إزالة الخريطة</button>}</div>
                </div>
              </form>

              <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 shadow-luxury space-y-5 text-xs">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><ImageIcon className="w-4 h-4 text-gold-400" /> شعار المطعم وصورة الغلاف</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3">
                    <div className="flex items-center justify-between"><label className="block font-bold text-luxury-200">شعار المطعم</label><span className="text-[10px] text-luxury-500">يظهر أعلى المنيو</span></div>
                    <div className="flex items-center gap-4"><div className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center shrink-0 border border-luxury-700 text-2xl font-serif font-bold text-luxury-950" style={logoPreview ? { background: 'transparent' } : { background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})` }}>{logoPreview ? <img src={logoPreview} alt={name} className="w-full h-full" style={{ objectFit: logoFit, objectPosition: logoPosition }} /> : (nameEn.charAt(0) || 'م')}</div><div className="space-y-2 flex-1"><input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => handleUpload('logo', e.target.files?.[0])} /><button type="button" onClick={() => logoInputRef.current?.click()} disabled={uploading !== null} className="w-full py-2 rounded-xl bg-luxury-850 border border-luxury-700 text-luxury-100 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60">{uploading === 'logo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-gold-400" />}{uploading === 'logo' ? 'جاري رفع الشعار...' : 'رفع شعار'}</button></div></div>
                    <div><label className="block text-luxury-400 mb-1">أو رابط مباشر</label><input type="url" dir="ltr" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2 rounded-lg text-left" /></div>
                    {logoPreview && <div className="pt-3 border-t border-luxury-800 space-y-3"><div><span className="block text-luxury-300 font-bold mb-1.5">طريقة الإظهار</span><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setLogoFit('cover')} className={`px-3 py-2 rounded-xl border text-[11px] font-bold ${logoFit === 'cover' ? 'bg-gold-500/15 border-gold-500/60 text-gold-300' : 'bg-luxury-900 border-luxury-800 text-luxury-400'}`}>تغطية (قصّ)</button><button type="button" onClick={() => setLogoFit('contain')} className={`px-3 py-2 rounded-xl border text-[11px] font-bold ${logoFit === 'contain' ? 'bg-gold-500/15 border-gold-500/60 text-gold-300' : 'bg-luxury-900 border-luxury-800 text-luxury-400'}`}>كامل</button></div></div><div><span className="block text-luxury-300 font-bold mb-1.5">الموضع</span><div className="grid grid-cols-3 gap-1.5 w-full max-w-[150px]">{LOGO_POSITION_GRID.map((cell) => { const active = logoPosition === cell.value; return <button key={cell.value} type="button" title={cell.label} onClick={() => setLogoPosition(cell.value)} className={`h-9 rounded-lg border flex items-center justify-center ${active ? 'bg-gold-500/20 border-gold-500/70' : 'bg-luxury-900 border-luxury-800'}`}><span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-gold-400' : 'bg-luxury-600'}`} /></button>; })}</div></div></div>}
                  </div>
                  <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3">
                    <div className="flex items-center justify-between"><label className="block font-bold text-luxury-200">صورة الغلاف</label><span className="text-[10px] text-luxury-500">Hero</span></div>
                    <div className="h-24 rounded-xl overflow-hidden border border-luxury-700 bg-luxury-900 flex items-center justify-center">{coverImage ? <img src={coverImage} alt="غلاف" className="w-full h-full object-cover" /> : <span className="text-[10px] text-luxury-500">لا توجد صورة غلاف</span>}</div>
                    <div className="space-y-2"><input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => handleUpload('cover', e.target.files?.[0])} /><button type="button" onClick={() => coverInputRef.current?.click()} disabled={uploading !== null} className="w-full py-2 rounded-xl bg-luxury-850 border border-luxury-700 text-luxury-100 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60">{uploading === 'cover' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-gold-400" />}{uploading === 'cover' ? 'جاري رفع الغلاف...' : 'رفع غلاف'}</button></div>
                  </div>
                </div>
              </div>

              <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 space-y-5 text-xs">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><Video className="w-4 h-4 text-gold-400" /> فيديو ومعرض الصالة</h3>
                <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3"><label className="block font-bold text-luxury-200">رابط الفيديو الترويجي</label><input type="url" dir="ltr" value={promoVideoUrl} onChange={(e) => setPromoVideoUrl(e.target.value)} placeholder="https://... or youtube" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl font-mono text-[11px]" />{promoVideoUrl && <div className="p-2.5 rounded-xl bg-luxury-900 border border-gold-500/30 flex items-center justify-between text-gold-300"><span className="flex items-center gap-1.5 text-[11px]"><Film className="w-4 h-4 text-gold-400" /> سيظهر زر فيديو الأجواء في المنيو</span><button type="button" onClick={() => setPromoVideoUrl('')} className="text-red-400 text-[11px]">إزالة</button></div>}</div>
                <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-4"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><label className="block font-bold text-luxury-200">صور الصالة ({galleryImages.length})</label><p className="text-[10px] text-luxury-400">لقطات الصالة والديكورات</p></div><div className="flex items-center gap-2"><input ref={galleryInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => handleUploadGalleryFile(e.target.files?.[0])} /><button type="button" onClick={() => galleryInputRef.current?.click()} disabled={uploadingGallery} className="px-3 py-1.5 rounded-xl bg-gold-500 text-luxury-950 font-bold text-xs flex items-center gap-1.5 disabled:opacity-60"><Plus className="w-3.5 h-3.5" /> رفع صورة</button></div></div><div className="flex gap-2"><input type="url" dir="ltr" value={newGalleryUrl} onChange={(e) => setNewGalleryUrl(e.target.value)} placeholder="أو رابط صورة https://..." className="flex-1 bg-luxury-900 border border-luxury-800 text-luxury-100 p-2 rounded-xl text-xs font-mono" /><button type="button" onClick={handleAddGalleryImage} className="px-3 py-2 bg-luxury-850 text-luxury-200 font-bold rounded-xl text-xs">إضافة</button></div>{galleryImages.length > 0 && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">{galleryImages.map((url, i) => <div key={i} className="relative group rounded-xl overflow-hidden border border-luxury-800 h-24 bg-luxury-900"><img src={url} alt={`صالة ${i + 1}`} className="w-full h-full object-cover" /><button type="button" onClick={() => handleRemoveGalleryImage(i)} className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button></div>)}</div>}</div>
              </div>

              <div className="pt-4 border-t border-luxury-850 space-y-4">
                <div>
                  <h4 className="font-bold text-luxury-100 text-sm flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-gold-400" />
                    إعدادات الدفع — تحويل العميل
                  </h4>
                  <p className="text-[10px] text-luxury-400 mt-1 leading-relaxed">
                    تظهر هذه البيانات للعميل داخل نافذة «الدفع عبر حوالة بنكية أو محفظة» ليعرف إلى أين يحوّل المبلغ. املأ القناة التي تستقبل بها فعلاً — الحقل الفارغ لا يظهر للعميل، وتظهر بدلاً منه رسالة آمنة. لا تُستخدم هذه البيانات في التحقق من الدفع؛ الكاشير يؤكد الحوالة من صورة الإشعار التي يرسلها العميل.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3">
                  <span className="flex items-center gap-1.5 font-bold text-luxury-100 text-xs">
                    <Landmark className="w-3.5 h-3.5 text-gold-400" />
                    حوالة بنكية
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-transfer-bank-name">اسم البنك</label>
                      <input id="brandingsettingsview-transfer-bank-name" type="text" value={transferBankName} onChange={(e) => setTransferBankName(e.target.value)} maxLength={80} autoComplete="off" placeholder="مثال: بنك فلسطين" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60" />
                    </div>
                    <div>
                      <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-transfer-bank-holder">اسم صاحب الحساب</label>
                      <input id="brandingsettingsview-transfer-bank-holder" type="text" value={transferBankAccountHolder} onChange={(e) => setTransferBankAccountHolder(e.target.value)} maxLength={80} autoComplete="off" placeholder="الاسم كما يظهر لدى البنك" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60" />
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-transfer-bank-account">رقم الحساب / IBAN</label>
                    <input id="brandingsettingsview-transfer-bank-account" type="text" value={transferBankAccount} onChange={(e) => setTransferBankAccount(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} dir="ltr" inputMode="text" placeholder="PS52 PALS 0453 1234 5678 9012 3456 7" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60 text-left font-mono" />
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3">
                  <span className="flex items-center gap-1.5 font-bold text-luxury-100 text-xs">
                    <Wallet className="w-3.5 h-3.5 text-gold-400" />
                    محفظة إلكترونية
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-transfer-wallet-name">اسم المحفظة</label>
                      <input id="brandingsettingsview-transfer-wallet-name" type="text" value={transferWalletName} onChange={(e) => setTransferWalletName(e.target.value)} maxLength={80} autoComplete="off" placeholder="مثال: محفظة جوال" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60" />
                    </div>
                    <div>
                      <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-transfer-wallet-holder">اسم صاحب المحفظة</label>
                      <input id="brandingsettingsview-transfer-wallet-holder" type="text" value={transferWalletAccountHolder} onChange={(e) => setTransferWalletAccountHolder(e.target.value)} maxLength={80} autoComplete="off" placeholder="الاسم المسجَّل على المحفظة" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60" />
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-transfer-wallet-number">رقم المحفظة (هاتف أو رقم حساب)</label>
                    <input id="brandingsettingsview-transfer-wallet-number" type="text" value={transferWalletNumber} onChange={(e) => setTransferWalletNumber(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} dir="ltr" inputMode="tel" placeholder="0599123456" className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60 text-left font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-transfer-instructions">تعليمات التحويل <span className="font-normal text-luxury-500">(اختياري — تظهر للقناتين)</span></label>
                  <textarea id="brandingsettingsview-transfer-instructions" value={transferInstructions} onChange={(e) => setTransferInstructions(e.target.value)} maxLength={500} rows={3} placeholder="مثال: اكتب رقم الطاولة في ملاحظة التحويل، وأرسل صورة الإشعار بعد التحويل مباشرة." className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60 resize-y" />
                </div>
              </div>

              <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 space-y-4 text-xs">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><CreditCard className="w-4 h-4 text-gold-400" /> الدفع والتواصل</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-contact-whatsapp">واتساب الحجز</label><input id="brandingsettingsview-contact-whatsapp" type="tel" dir="ltr" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} maxLength={24} className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl font-mono text-left" placeholder="+970599123456" /></div>
                  {SOCIAL_FIELDS.map((field) => { const Icon = field.icon; const value = socialValues[field.stateKey]; const setValue = socialSetters[field.stateKey]; const inputId = `brandingsettingsview-contact-${field.key}`; return <div key={field.key}><label className="flex items-center gap-1.5 font-bold text-luxury-200 mb-1" htmlFor={inputId}><Icon className="w-3.5 h-3.5 text-luxury-500" /> {field.label} <span className="font-normal text-luxury-500">(اختياري)</span></label><input id={inputId} type="url" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} maxLength={1000} className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl font-mono text-[11px] text-left" placeholder={field.placeholder} /></div>; })}
                </div>
              </div>

              <button onClick={() => handleSave()} disabled={isSaving || uploading !== null} className="w-full px-5 py-3 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} حفظ الهوية البصرية
              </button>
            </>
          )}

          {activeTab === 'advanced' && (
            <>
              <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-5 space-y-4">
                <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><Layers className="w-4 h-4 text-gold-400" /> وراثة الثيم والنسخ</h3>
                <p className="text-[11px] text-luxury-400">النظام يطبق الوراثة: Platform → Restaurant → Branch. إذا لم يوجد ثيم للفرع، يأخذ ثيم المطعم، وإذا لم يوجد يأخذ ثيم المنصة، وإلا الافتراضي.</p>

                <div className="p-4 rounded-xl bg-luxury-950 border border-luxury-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between"><span className="text-luxury-400">المصدر الحالي:</span><span className="text-luxury-100 font-bold">{effectiveTheme?.source || 'fallback'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-luxury-400">الفرع المحدد:</span><span className="text-luxury-100">{selectedBranchId ? (branches || []).find(b => b.id === selectedBranchId)?.name || selectedBranchId : 'المطعم (كل الفروع)'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-luxury-400">هل يوجد ثيم مخزن؟</span><span className={storedTheme ? 'text-emerald-400' : 'text-luxury-500'}>{storedTheme ? 'نعم' : 'لا — يرث من المستوى الأعلى'}</span></div>
                                  </div>

                                <div className="space-y-2">
                    <span className="text-xs font-bold text-luxury-200">إعادة تعيين</span>
                    <p className="text-[11px] text-luxury-400">حذف ثيم {selectedBranchId ? 'الفرع' : 'المطعم'} والرجوع للوراثة من المستوى الأعلى.</p>
                    <button onClick={handleResetTheme} disabled={themeSaving} className="w-full px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center justify-center gap-1.5">
                      <RotateCcw className="w-4 h-4" /> إعادة تعيين وحذف الثيم
                    </button>
                  </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Live Preview */}
        <div className="lg:col-span-2 lg:sticky lg:top-24 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2"><Eye className="w-4 h-4 text-gold-400" /> معاينة حية</h3>
            <div className="flex items-center gap-1 p-1 bg-luxury-900 border border-luxury-800 rounded-xl">
              {[
                { id: 'mobile', icon: Smartphone, label: 'جوال' },
                { id: 'tablet', icon: Monitor, label: 'تابلت' },
                { id: 'desktop', icon: Monitor, label: 'سطح مكتب' },
              ].map((d) => {
                const Icon = d.icon;
                const sel = previewDevice === d.id;
                return <button key={d.id} onClick={() => setPreviewDevice(d.id as any)} className={`p-1.5 rounded-lg ${sel ? 'bg-gold-500 text-luxury-950' : 'text-luxury-500 hover:text-luxury-200'}`} title={d.label}><Icon className="w-4 h-4" /></button>;
              })}
            </div>
          </div>

          <div className={`mx-auto rounded-[2rem] border-[6px] border-luxury-800 bg-[#0B0C0F] shadow-2xl overflow-hidden relative ${previewDevice === 'mobile' ? 'w-[320px]' : previewDevice === 'tablet' ? 'w-[480px]' : 'w-full'}`} style={previewVars as any}>
            {/* Background layer preview */}
            {(editConfig.background?.dark || effectiveTheme?.background.dark) && (
              <div className="absolute inset-0 -z-10 pointer-events-none">
                {/* Simplified background preview */}
                <div className="w-full h-full" style={{
                  backgroundColor: (editConfig.background?.dark?.color || effectiveTheme?.background.dark.color || effectiveTheme?.colors.background) as any,
                  backgroundImage: editConfig.background?.dark?.gradient || effectiveTheme?.background.dark.gradient || undefined,
                }} />
              </div>
            )}

            <div className="relative">
              <div className="h-40 w-full relative">
                {coverImage ? <img src={coverImage} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${editConfig.colors?.secondary || accentColor}33, ${editConfig.colors?.primary || primaryColor}55)` }} />}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(7,8,10,0.95), rgba(7,8,10,0.15))' }} />
                <div className="absolute top-2 inset-x-3 flex items-center justify-between text-[11px] text-luxury-200/90 font-mono"><span>9:41</span><span className="w-16 h-3.5 rounded-full bg-black/60 border border-luxury-700" /></div>
                <div className="absolute bottom-3 inset-x-4 flex items-end gap-3">
                  <div className="w-12 h-12 rounded-2xl overflow-hidden flex items-center justify-center border-2 shadow-lg shrink-0 text-lg font-serif font-bold text-white" style={{ background: logoPreview ? 'transparent' : `linear-gradient(135deg, ${editConfig.colors?.primary || primaryColor}, ${editConfig.colors?.accent || accentColor})`, borderColor: `${editConfig.colors?.primary || primaryColor}99` }}>
                    {logoPreview ? <img src={logoPreview} alt="" className="w-full h-full" style={{ objectFit: logoFit, objectPosition: logoPosition }} /> : (nameEn.charAt(0) || 'م')}
                  </div>
                  <div className="min-w-0 pb-0.5"><div className="text-sm font-serif font-bold text-white truncate" style={{ fontFamily: 'var(--font-family)' }}>{name || 'اسم المطعم'}</div><div className="text-[11px] text-luxury-300 truncate">{nameEn || 'Restaurant Name'}</div></div>
                </div>
              </div>

              {galleryImages.length > 0 && <div className="px-3 pt-2"><div className="flex gap-1.5 overflow-hidden rounded-lg p-1 bg-luxury-900 border border-luxury-800">{galleryImages.slice(0, 3).map((g, idx) => <img key={idx} src={g} alt="" className="w-10 h-8 rounded object-cover" />)}{galleryImages.length > 3 && <span className="text-[11px] text-gold-400 self-center font-mono">+{galleryImages.length - 3}</span>}</div></div>}

              <div className="p-3.5 space-y-2.5">
                <div className="flex gap-1.5 overflow-hidden">
                  {['الأطباق الرئيسية', 'مشاوي', 'مقبلات'].map((c) => (
                    <span key={c} className="px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap text-white" style={{ background: `${editConfig.colors?.primary || primaryColor}22`, color: editConfig.colors?.primary || primaryColor, border: `1px solid ${editConfig.colors?.primary || primaryColor}55`, borderRadius: editConfig.radius?.full || '9999px' }}>{c}</span>
                  ))}
                </div>
                {[{ n: 'تندرلوين مشوي مع صوص الترافل', p: 135 }, { n: 'مقبلات البحر المتوسط الملكية', p: 85 }].map((dish, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-luxury-900/90 border border-luxury-800 rounded-xl p-2" style={{ borderRadius: editConfig.cards?.radius || editConfig.radius?.lg || '16px', boxShadow: resolveThemeShadow(editConfig.cards?.shadow, editConfig.shadows) || '0 4px 12px rgba(0,0,0,0.3)' }}>
                    <div className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center text-white/90 text-lg" style={{ background: `linear-gradient(135deg, ${editConfig.colors?.secondary || accentColor}55, ${editConfig.colors?.primary || primaryColor}88)` }}><UtensilsCrossed className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0"><div className="text-[10px] font-bold text-luxury-100 truncate" style={{ fontFamily: 'var(--font-family)' }}>{dish.n}</div><div className="text-[11px] text-luxury-400 flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> 15-20 دقيقة</div><div className="text-[10px] font-bold mt-0.5" style={{ color: editConfig.colors?.primary || primaryColor }}>{currency} {dish.p}</div></div>
                    <button className="w-6 h-6 rounded-lg flex items-center justify-center text-white font-bold shrink-0" style={{ background: `linear-gradient(135deg, ${editConfig.colors?.primary || primaryColor}, ${editConfig.colors?.accent || accentColor})`, borderRadius: editConfig.radius?.md || '10px' }}><Plus className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between"><span className="text-luxury-400">الوضع</span><span className="text-luxury-100 font-bold">{editConfig.mode || 'dark'}</span></div>
            <div className="flex items-center justify-between"><span className="text-luxury-400">المصدر</span><span className="text-luxury-100">{effectiveTheme?.source}</span></div>
            <div className="flex items-center justify-between"><span className="text-luxury-400">الخط</span><span className="text-luxury-100" style={{ fontFamily: FONT_OPTIONS.find(f => f.id === (editConfig.typography?.fontFamily || 'tajawal'))?.family }}>{FONT_OPTIONS.find(f => f.id === (editConfig.typography?.fontFamily || 'tajawal'))?.label}</span></div>
            <div className="flex items-center justify-between"><span className="text-luxury-400">خلفية فاتح</span><span className="text-luxury-100">{editConfig.background?.light?.type}</span></div>
            <div className="flex items-center justify-between"><span className="text-luxury-400">خلفية داكن</span><span className="text-luxury-100">{editConfig.background?.dark?.type}</span></div>
          </div>

          <p className="text-[10px] text-luxury-500 text-center px-4 leading-relaxed">المعاينة تطبق الثيم الحالي مع دعم Mobile/Tablet/Desktop — احفظ الثيم ليظهر لعملائك في القائمة العامة.</p>
        </div>
      </div>
    </div>
  );
};
