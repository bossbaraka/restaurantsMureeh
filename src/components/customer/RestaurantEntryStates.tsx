import React, { useEffect, useMemo, useState } from 'react';
import type { Restaurant } from '../../types/restaurant';
import { QrEntryReason, QrEntryErrorKind } from '../../context/RestaurantContext';
import { optimizeImageUrl } from './ProductImage';
import { useBrandTheme } from '../../theme/brandTheme';
import { PlexusField } from './PlexusField';
import {
  QrCode,
  MapPin,
  WifiOff,
  PauseCircle,
  Wrench,
  Hourglass,
  Clock,
  RotateCcw,
  Phone,
  Send,
} from 'lucide-react';

/**
 * Restaurant Entry States — the composed screens a guest lands on around the
 * QR journey (before the menu, instead of the old dead-ends):
 *
 *   QrResolvingScreen         — the table session is being created
 *   RestaurantUnavailableScreen — the venue is suspended / in maintenance /
 *                                 still onboarding (brand, not an error)
 *   QrErrorScreen             — invalid QR / restaurant not found / no network
 *   QrRequiredPrompt          — the catalog opened in a browser without a QR
 *
 * DESIGN CONTRACT
 * ---------------
 * Same world as the entry experience (`.entry-*`): the tenant's own cover
 * photography or brand-built ambience, its `--brand-*` tokens, Tajawal type,
 * safe-area aware, deterministic (no Math.random), CSS-only motion and fully
 * `prefers-reduced-motion` aware. Every selector is `.qrstate-*` — isolated
 * from, and dependent on, nothing outside this block + the brand tokens.
 *
 * NO business logic here: no fetch, no session, no storage. The screens
 * render what `RestaurantContext` already resolved and hand back exactly two
 * intents — retry and contact support.
 */

interface EntryStateProps {
  restaurant: Restaurant | null;
}

/** When the resolving screen has been up this long, the slow-connection hint appears. */
const RESOLVE_HINT_MS = 8000;

const SUPPORT_TELEGRAM = 'https://t.me/Mureeh_tech_bot';

/** Deterministic ambient motes — a fixed field, never a particle system. */
const MOTES: ReadonlyArray<{ left: number; top: number; size: number; delay: number; duration: number; driftX: number }> = [
  { left: 10, top: 22, size: 3, delay: 0, duration: 19, driftX: 12 },
  { left: 27, top: 64, size: 2, delay: 2.2, duration: 23, driftX: -9 },
  { left: 46, top: 14, size: 3, delay: 1.1, duration: 17, driftX: 8 },
  { left: 62, top: 78, size: 2, delay: 3.4, duration: 25, driftX: -14 },
  { left: 78, top: 30, size: 3, delay: 0.7, duration: 18, driftX: 11 },
  { left: 90, top: 60, size: 2, delay: 4.6, duration: 22, driftX: -7 },
  { left: 36, top: 44, size: 2, delay: 5.8, duration: 27, driftX: 10 },
  { left: 70, top: 88, size: 3, delay: 2.8, duration: 20, driftX: -12 },
  { left: 8, top: 80, size: 2, delay: 6.4, duration: 24, driftX: 6 },
  { left: 84, top: 10, size: 2, delay: 7.1, duration: 21, driftX: -5 },
];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);
  return reduced;
}

/** Tenant language drives the whole state layer (dir + copy language). */
function useEntryLanguage(restaurant: Restaurant | null) {
  const isEnglish = restaurant?.language === 'en';
  return { isEnglish, dir: isEnglish ? 'ltr' : 'rtl' as const };
}

/** The venue's own crest (logo or monogram) — the anchor of every state card. */
const QrStateCrest: React.FC<{ restaurant: Restaurant | null; size?: 'md' | 'lg' }> = ({ restaurant, size = 'md' }) => {
  const logoSrc = (restaurant?.logo || '').trim();
  const monogram = (restaurant?.nameEn || restaurant?.name || 'م').trim().charAt(0).toUpperCase();
  return (
    <span className={`qrstate-crest qrstate-crest--${size}`} aria-hidden="true">
      <span className="qrstate-crest__halo" />
      <span className="qrstate-crest__disc">
        {logoSrc ? (
          <img
            className="qrstate-crest__img"
            src={logoSrc}
            alt=""
            decoding="async"
            draggable={false}
            style={{
              objectFit: restaurant?.logoFit === 'contain' ? 'contain' : 'cover',
              objectPosition: restaurant?.logoPosition || '50% 50%',
            }}
          />
        ) : (
          <span className="qrstate-crest__monogram">{monogram}</span>
        )}
      </span>
    </span>
  );
};

/**
 * A decorative QR glyph — three finder corners + a fixed data-module field.
 * It illustrates "a QR is involved here" without ever claiming to be a
 * scannable code; motion (scan line) belongs to the resolving screen only.
 */
const QrGlyph: React.FC<{ className?: string }> = ({ className }) => {
  // Fixed data modules on a 21×21 grid (deterministic — byte-identical paint).
  const modules: ReadonlyArray<[number, number]> = [
    [9, 1], [11, 1], [13, 1], [15, 2], [9, 3], [12, 3], [14, 3], [10, 4], [13, 4],
    [1, 9], [3, 9], [5, 9], [2, 11], [4, 11], [1, 13], [3, 13], [5, 13], [9, 9],
    [11, 9], [13, 10], [15, 9], [9, 11], [12, 11], [14, 11], [10, 13], [13, 13],
    [1, 15], [3, 15], [5, 15], [2, 17], [4, 17], [1, 19], [3, 19], [9, 15],
    [11, 15], [13, 16], [15, 15], [10, 17], [12, 17], [14, 18], [11, 19], [13, 19],
  ];
  return (
    <svg viewBox="0 0 23 23" className={className} role="presentation" focusable="false" aria-hidden="true">
      {/* Finder corners (top-left, top-right, bottom-left in grid terms). */}
      {(
        [
          [0, 0],
          [16, 0],
          [0, 16],
        ] as ReadonlyArray<[number, number]>
      ).map(([x, y], i) => (
        <g key={i}>
          <rect x={x + 0.5} y={y + 0.5} width="6" height="6" rx="1.1" fill="none" stroke="currentColor" strokeWidth="0.9" />
          <rect x={x + 2} y={y + 2} width="3" height="3" rx="0.6" fill="currentColor" />
        </g>
      ))}
      {/* Data field — a fixed constellation, never claimed to decode. */}
      {modules.map(([x, y], i) => (
        <rect key={i} x={x + 0.65} y={y + 0.65} width="1.4" height="1.4" rx="0.35" fill="currentColor" opacity="0.85" />
      ))}
    </svg>
  );
};

/** Full-bleed ambience: the venue's cover photo or the brand-built fallback. */
const QrStateAmbience: React.FC<{ restaurant: Restaurant | null; dimmed?: boolean }> = ({ restaurant, dimmed = false }) => {
  const coverSrc = useMemo(() => {
    const raw = (restaurant?.coverImage || '').trim();
    return raw ? optimizeImageUrl(raw, 1600, 80) : '';
  }, [restaurant?.coverImage]);

  return (
    <div className="qrstate-ambient" aria-hidden="true">
      {coverSrc ? (
        <>
          <img className="qrstate-ambient__img" src={coverSrc} alt="" loading="eager" decoding="async" draggable={false} />
          <div className={`qrstate-ambient__scrim${dimmed ? ' qrstate-ambient__scrim--dimmed' : ''}`} />
        </>
      ) : (
        <div className={`qrstate-ambient__fallback${dimmed ? ' qrstate-ambient__fallback--dimmed' : ''}`} />
      )}
      <div className="qrstate-ambient__vignette" />
    </div>
  );
};

const QrStateMotes: React.FC = () => (
  <div className="qrstate-motes" aria-hidden="true">
    {MOTES.map((mote, index) => (
      <span
        key={index}
        className="qrstate-mote"
        style={{
          left: `${mote.left}%`,
          top: `${mote.top}%`,
          width: `${mote.size}px`,
          height: `${mote.size}px`,
          animationDelay: `${mote.delay}s`,
          animationDuration: `${mote.duration}s`,
          ['--qrstate-mote-drift' as string]: `${mote.driftX}px`,
        }}
      />
    ))}
  </div>
);

/** Platform credit + support link — the smallest element of any state layer. */
const QrStateFooter: React.FC<{ isEnglish: boolean; showSupport?: boolean }> = ({ isEnglish, showSupport = true }) => (
  <div className="qrstate-footer">
    {showSupport && (
      <a
        href={SUPPORT_TELEGRAM}
        target="_blank"
        rel="noopener noreferrer"
        className="qrstate-support"
        title={isEnglish ? 'Contact platform support on Telegram' : 'تواصل مع دعم المنصة على تليجرام'}
      >
        <Send className="qrstate-support__icon" />
        <span>{isEnglish ? 'Need help? Contact support' : 'تحتاج مساعدة؟ تواصل مع الدعم'}</span>
      </a>
    )}
    <p className="qrstate-credit">{isEnglish ? 'Powered by Mureeh' : 'مدعوم بـ MUREEH'}</p>
  </div>
);

// ===========================================================================
// 1) RESOLVING — "we are opening your table"
// ===========================================================================
export const QrResolvingScreen: React.FC<EntryStateProps> = ({ restaurant }) => {
  useBrandTheme(restaurant?.primaryColor, restaurant?.accentColor);
  const { isEnglish, dir } = useEntryLanguage(restaurant);
  const reduced = useReducedMotion();
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowHint(true), RESOLVE_HINT_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="qrstate-root" dir={dir} role="status" aria-live="polite">
      <QrStateAmbience restaurant={restaurant} />
      {/* The constellation, a little brighter here — the wait should feel
          alive, and the scan frame reads as a node in the network. */}
      <PlexusField className="qrstate-plexus" count={26} speed={7} opacity={0.5} seed={23} />
      {!reduced && <QrStateMotes />}

      <div className="qrstate-stack">
        <QrStateCrest restaurant={restaurant} size="lg" />

        <div className="qrstate-scanner" aria-hidden="true">
          <span className="qrstate-scanner__corner qrstate-scanner__corner--tl" />
          <span className="qrstate-scanner__corner qrstate-scanner__corner--tr" />
          <span className="qrstate-scanner__corner qrstate-scanner__corner--bl" />
          <span className="qrstate-scanner__corner qrstate-scanner__corner--br" />
          <QrGlyph className="qrstate-scanner__glyph" />
          {!reduced && <span className="qrstate-scanner__line" />}
        </div>

        <div className="qrstate-card qrstate-card--resolving">
          <h1 className="qrstate-title">
            {isEnglish ? 'Preparing your table' : 'جارٍ تجهيز طاولتكم'}
          </h1>
          <p className="qrstate-sub">
            {isEnglish
              ? 'We are opening the menu bound to your table — one moment, please.'
              : 'نفتح لكم قائمة المطعم المرتبطة بطاولتكم… لحظة من فضلكم.'}
          </p>

          <div className={`qrstate-hint${showHint ? ' qrstate-hint--on' : ''}`} aria-hidden={!showHint}>
            {isEnglish
              ? 'Still waiting? Check your connection and try again.'
              : 'ما زلتم تنتظرون؟ تحققوا من اتصالكم بالإنترنت ثم أعدوا المحاولة.'}
          </div>

          {!reduced && (
            <div className="qrstate-progress" aria-hidden="true">
              <span className="qrstate-progress__fill" />
            </div>
          )}
        </div>
      </div>

      <QrStateFooter isEnglish={isEnglish} showSupport={false} />
    </div>
  );
};

// ===========================================================================
// 2) UNAVAILABLE — suspended / maintenance / onboarding (brand, not alarm)
// ===========================================================================
const UNAVAILABLE_COPY: Record<QrEntryReason, {
  ar: { title: string; sub: string };
  en: { title: string; sub: string };
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  SUSPENDED: {
    ar: {
      title: 'هذا المطعم غير متاح للطلب حالياً',
      sub: 'تم إيقاف خدمة الطلب مؤقتاً لهذا المطعم. يرجى مراجعة إدارة المطعم أو الكاشير.',
    },
    en: {
      title: 'This restaurant is not available for ordering right now',
      sub: 'Ordering has been temporarily paused for this venue. Please see the restaurant management or the cashier.',
    },
    Icon: PauseCircle,
  },
  MAINTENANCE: {
    ar: {
      title: 'المطعم تحت الصيانة الآن',
      sub: 'جاري تحديث النظام الآن… سيستأنف المطعم استقبال الطلبات خلال لحظات.',
    },
    en: {
      title: 'The restaurant is under maintenance',
      sub: 'We are updating the system… the restaurant will start accepting orders again in a moment.',
    },
    Icon: Wrench,
  },
  ONBOARDING: {
    ar: {
      title: 'المطعم يستعد لبدء العمل',
      sub: 'جارٍ تجهيز المطعم على المنصة… ارجعوا إلينا قريباً.',
    },
    en: {
      title: 'The restaurant is getting ready',
      sub: 'This venue is being set up on the platform… come back to us soon.',
    },
    Icon: Hourglass,
  },
  INACTIVE: {
    ar: {
      title: 'المطعم غير متاح حالياً',
      sub: 'لم يتمكن النظام من تفعيل خدمة الطلب لهذا المطعم. يرجى مراجعة إدارة المطعم.',
    },
    en: {
      title: 'The restaurant is not available',
      sub: 'The system could not activate ordering for this venue. Please see the restaurant management.',
    },
    Icon: Clock,
  },
};

export const RestaurantUnavailableScreen: React.FC<EntryStateProps & {
  reason: QrEntryReason;
  onRetry: () => void;
}> = ({ restaurant, reason, onRetry }) => {
  useBrandTheme(restaurant?.primaryColor, restaurant?.accentColor);
  const { isEnglish, dir } = useEntryLanguage(restaurant);
  const copy = UNAVAILABLE_COPY[reason];
  const Icon = copy.Icon;
  const text = isEnglish ? copy.en : copy.ar;
  const name = isEnglish
    ? (restaurant?.nameEn || restaurant?.name || '')
    : (restaurant?.name || restaurant?.nameEn || '');
  const phone = (restaurant?.phone || '').trim();

  return (
    <div className="qrstate-root" dir={dir}>
      <QrStateAmbience restaurant={restaurant} dimmed />
      {/* A dimmed constellation — the venue is present, but at rest. */}
      <PlexusField className="qrstate-plexus" count={14} speed={4} opacity={0.3} seed={41} />
      <QrStateMotes />

      <div className="qrstate-stack">
        <QrStateCrest restaurant={restaurant} size="lg" />

        <div className="qrstate-card qrstate-card--unavailable">
          <span className="qrstate-statusicon qrstate-statusicon--muted">
            <Icon className="qrstate-statusicon__glyph" />
          </span>

          {name && <p className="qrstate-venue">{name}</p>}
          <h1 className="qrstate-title">{text.title}</h1>
          <p className="qrstate-sub">{text.sub}</p>

          <div className="qrstate-actions">
            <button type="button" className="qrstate-btn qrstate-btn--primary" onClick={onRetry}>
              <RotateCcw className="qrstate-btn__icon" />
              <span>{isEnglish ? 'Try again' : 'إعادة المحاولة'}</span>
            </button>
            {phone && (
              <a
                type="button"
                className="qrstate-btn qrstate-btn--ghost"
                href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                dir="ltr"
              >
                <Phone className="qrstate-btn__icon" />
                <span>{phone}</span>
              </a>
            )}
          </div>
        </div>
      </div>

      <QrStateFooter isEnglish={isEnglish} />
    </div>
  );
};

// ===========================================================================
// 3) ERROR — invalid QR / not found / no network (composed, not alarming)
// ===========================================================================
const ERROR_COPY: Record<QrEntryErrorKind, {
  ar: { title: string; sub: string };
  en: { title: string; sub: string };
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  INVALID_QR: {
    ar: {
      title: 'تعذر فتح القائمة عبر رمز QR',
      sub: 'تأكد أن الرمز الذي مسحته هو المطبوع على طاولتك، ثم أعد المحاولة.',
    },
    en: {
      title: 'We could not open the menu from this QR',
      sub: 'Make sure you scanned the code printed on your table, then try again.',
    },
    Icon: QrCode,
  },
  NOT_FOUND: {
    ar: {
      title: 'لم يتم العثور على المطعم',
      sub: 'قد يكون الرابط غير مكتمل أو أن المطعم غير مسجل على المنصة بعد.',
    },
    en: {
      title: 'Restaurant not found',
      sub: 'The link may be incomplete, or the restaurant is not registered on the platform yet.',
    },
    Icon: MapPin,
  },
  NETWORK: {
    ar: {
      title: 'لا يوجد اتصال بالشبكة',
      sub: 'تحقق من اتصالك بالإنترنت أو شبكة الواي فاي في المطعم ثم أعد المحاولة.',
    },
    en: {
      title: 'No network connection',
      sub: 'Check your internet or the restaurant Wi-Fi, then try again.',
    },
    Icon: WifiOff,
  },
};

export const QrErrorScreen: React.FC<EntryStateProps & {
  kind: QrEntryErrorKind;
  message?: string;
  onRetry: () => void;
}> = ({ restaurant, kind, message, onRetry }) => {
  useBrandTheme(restaurant?.primaryColor, restaurant?.accentColor);
  const { isEnglish, dir } = useEntryLanguage(restaurant);
  const copy = ERROR_COPY[kind];
  const Icon = copy.Icon;
  const text = isEnglish ? copy.en : copy.ar;
  const name = isEnglish
    ? (restaurant?.nameEn || restaurant?.name || '')
    : (restaurant?.name || restaurant?.nameEn || '');
  const phone = (restaurant?.phone || '').trim();

  // The server's exact reason, shown only when it adds information beyond
  // the composed copy above (no duplicated lines).
  const serverMessage = (message || '').trim();
  const showsServerMessage =
    serverMessage.length > 0 &&
    serverMessage !== (isEnglish ? copy.en.sub : copy.ar.sub) &&
    serverMessage !== (kind === 'INVALID_QR' ? 'رمز QR غير صالح' : 'المطعم غير موجود');

  return (
    <div className="qrstate-root" dir={dir}>
      <QrStateAmbience restaurant={restaurant} />
      <PlexusField className="qrstate-plexus" count={14} speed={4} opacity={0.3} seed={57} />
      <QrStateMotes />

      <div className="qrstate-stack">
        <QrStateCrest restaurant={restaurant} size="lg" />

        <div className="qrstate-card qrstate-card--error">
          <span className="qrstate-statusicon qrstate-statusicon--error">
            <Icon className="qrstate-statusicon__glyph" />
          </span>

          {name && <p className="qrstate-venue">{name}</p>}
          <h1 className="qrstate-title">{text.title}</h1>
          <p className="qrstate-sub">{text.sub}</p>

          {showsServerMessage && (
            <p className="qrstate-servermsg" dir="rtl">{serverMessage}</p>
          )}

          <div className="qrstate-actions">
            <button type="button" className="qrstate-btn qrstate-btn--primary" onClick={onRetry}>
              <RotateCcw className="qrstate-btn__icon" />
              <span>{isEnglish ? 'Try again' : 'إعادة المحاولة'}</span>
            </button>
            {phone && (
              <a
                type="button"
                className="qrstate-btn qrstate-btn--ghost"
                href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                dir="ltr"
              >
                <Phone className="qrstate-btn__icon" />
                <span>{phone}</span>
              </a>
            )}
          </div>
        </div>
      </div>

      <QrStateFooter isEnglish={isEnglish} />
    </div>
  );
};

// ===========================================================================
// 4) QR REQUIRED — the catalog opened in a browser, no table was scanned
// ===========================================================================
export const QrRequiredPrompt: React.FC<EntryStateProps> = ({ restaurant }) => {
  useBrandTheme(restaurant?.primaryColor, restaurant?.accentColor);
  const { isEnglish, dir } = useEntryLanguage(restaurant);
  const name = isEnglish
    ? (restaurant?.nameEn || restaurant?.name || '')
    : (restaurant?.name || restaurant?.nameEn || '');

  return (
    <div className="qrstate-root" dir={dir}>
      <QrStateAmbience restaurant={restaurant} />
      <PlexusField className="qrstate-plexus" count={18} speed={5} opacity={0.38} seed={67} />
      <QrStateMotes />

      <div className="qrstate-stack">
        <QrStateCrest restaurant={restaurant} size="lg" />

        <div className="qrstate-card qrstate-card--required">
          <span className="qrstate-statusicon qrstate-statusicon--brand">
            <QrGlyph className="qrstate-statusicon__qr" />
          </span>

          {name && <p className="qrstate-venue">{name}</p>}
          <h1 className="qrstate-title">
            {isEnglish ? 'Open the menu with a QR code' : 'افتح القائمة عبر رمز QR'}
          </h1>
          <p className="qrstate-sub">
            {isEnglish
              ? `Scan the code on your table to open ${name || 'the'} menu and order directly.`
              : `امسح الرمز المطبوع على طاولتكم لفتح قائمة ${name || 'المطعم'} والطلب مباشرة.`}
          </p>
        </div>
      </div>

      <QrStateFooter isEnglish={isEnglish} />
    </div>
  );
};
