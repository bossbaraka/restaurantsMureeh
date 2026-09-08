import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useBrandTheme } from '../../theme/brandTheme';
import { formatPrice } from '../../utils/formatting';
import { generateQrDataUrl } from '../../utils/qrCodeGenerator';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  Gauge,
  Link2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Pause,
  Play,
  QrCode,
  Sparkles,
  X,
} from 'lucide-react';

/**
 * Display Menu (عرض للقراءة فقط)
 * =============================
 * A presentation-only rendering of the restaurant's menu, built for TVs in the
 * dining room and for social-media recording: no cart, no add-to-cart, no table
 * gate, no ordering affordances of any kind. Guests cannot order from it even by
 * accident, and it is safe to screen-record or screenshot.
 *
 * It reads the same catalog + brand colors as the ordering menu, then renders
 * them as an auto-advancing "menu board" that a restaurant can film or leave
 * running on a wall screen.
 */

interface DisplaySettings {
  autoplay: boolean;
  /** Seconds each category stays on screen. */
  dwellSeconds: number;
  /** Scroll the current category slowly instead of snapping to the next one. */
  smoothScroll: boolean;
  showImages: boolean;
  showControls: boolean;
}

const SPEED_OPTIONS = [6, 9, 14] as const;

const DISPLAY_FALLBACK: DisplaySettings = {
  autoplay: true,
  dwellSeconds: 9,
  smoothScroll: true,
  showImages: true,
  showControls: true,
};

/** Deterministic hash so a dish keeps the same accent tile across renders. */
const tileTone = (id: string, count: number): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % Math.max(1, count);
};

const useClock = (enabled: boolean): string => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
};

export const DisplayMenu: React.FC = () => {
  const { products, categories, currentRestaurant } = useRestaurant();

  // Same tenant palette the ordering menu uses — the display never diverges.
  useBrandTheme(currentRestaurant?.primaryColor, currentRestaurant?.accentColor);

  const [settings, setSettings] = useState<DisplaySettings>(DISPLAY_FALLBACK);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const clock = useClock(settings.showControls === false);

  // Only dishes that are on the board right now: hide anything the kitchen
  // marked unavailable so a filmed menu never advertises a sold-out plate.
  const sections = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          items: products.filter((p) => p.categoryId === category.id && p.isAvailable !== false),
        }))
        .filter((section) => section.items.length > 0),
    [categories, products]
  );

  const safeIndex = sections.length === 0 ? 0 : activeIndex % sections.length;
  const section = sections[safeIndex];
  const sectionId = section?.category.id;
  const currency = currentRestaurant?.currency || '₪';

  const update = useCallback((patch: Partial<DisplaySettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const goTo = useCallback(
    (index: number) => {
      if (sections.length === 0) return;
      const next = ((index % sections.length) + sections.length) % sections.length;
      setActiveIndex(next);
      if (scrollerRef.current) scrollerRef.current.scrollTo({ top: 0, behavior: 'auto' });
    },
    [sections.length]
  );

  // Auto-advance: one timer drives both the smooth scroll and the next section,
  // so a recording never shows a jump cut mid-category.
  useEffect(() => {
    if (!settings.autoplay || sections.length < 2) return;
    const bar = progressRef.current;
    const dwellMs = settings.dwellSeconds * 1000;
    const startedAt = Date.now();
    const ticker = window.setInterval(() => {
      const ratio = Math.min(1, (Date.now() - startedAt) / dwellMs);
      if (bar) bar.style.width = `${ratio * 100}%`;
    }, 120);
    const timer = window.setTimeout(() => goTo(safeIndex + 1), dwellMs);
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(timer);
      if (bar) bar.style.width = '0%';
    };
  }, [settings.autoplay, settings.dwellSeconds, safeIndex, sections.length, goTo]);

  // Slow drift inside a long category keeps a wall screen feeling alive.
  useEffect(() => {
    if (!settings.autoplay || !settings.smoothScroll || !sectionId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const id = window.setInterval(() => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 2) return;
      const next = Math.min(max, el.scrollTop + 1.2);
      el.scrollTo({ top: next, behavior: 'auto' });
    }, 60);
    return () => window.clearInterval(id);
  }, [settings.autoplay, settings.smoothScroll, sectionId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goTo(safeIndex + 1);
      else if (event.key === 'ArrowRight') goTo(safeIndex - 1);
      else if (event.key === ' ') {
        event.preventDefault();
        update({ autoplay: !settings.autoplay });
      } else if (event.key.toLowerCase() === 'f') toggleFullscreen();
      else if (event.key.toLowerCase() === 'h') update({ showControls: !settings.showControls });
      else if (event.key === 'Escape') setShowQr(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  }

  const displayUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = currentRestaurant?.slug || 'mureeh';
    return `${window.location.origin}/r/${slug}?view=display`;
  }, [currentRestaurant?.slug]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }, [displayUrl]);

  const [qrDataUrl, setQrDataUrl] = useState('');
  useEffect(() => {
    if (!showQr || !displayUrl) return;
    let cancelled = false;
    void generateQrDataUrl('display', currentRestaurant?.slug || 'mureeh', displayUrl).then(
      (dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [showQr, displayUrl, currentRestaurant?.slug]);

  const restaurantName = currentRestaurant?.name || 'المطعم';
  const restaurantNameEn = currentRestaurant?.nameEn || '';

  return (
    <div className="display-menu" dir="rtl" data-testid="display-menu">
      <div className="display-menu__stage">
        {/* ---------- Header ---------- */}
        <header className="display-menu__header">
          <div className="display-menu__brand">
            <span className="display-menu__crest" aria-hidden="true">
              <Crown className="display-menu__crest-icon" />
            </span>
            <div className="display-menu__titles">
              <h1 className="display-menu__name">{restaurantName}</h1>
              {(restaurantNameEn || currentRestaurant?.description) && (
                <p className="display-menu__tagline">
                  {restaurantNameEn}
                  {restaurantNameEn && currentRestaurant?.description ? ' · ' : ''}
                  {currentRestaurant?.description || ''}
                </p>
              )}
            </div>
          </div>
          <div className="display-menu__meta">
            <span className="display-menu__chip">
              <MonitorPlay className="display-menu__chip-icon" />
              عرض القائمة
            </span>
            {clock && <span className="display-menu__clock">{clock}</span>}
          </div>
        </header>

        {/* ---------- Board ---------- */}
        {section ? (
          <div className="display-menu__board" ref={scrollerRef}>
            <div className="display-menu__section-head">
              <div>
                <h2 className="display-menu__section-title">{section.category.name}</h2>
                {section.category.nameEn && (
                  <p className="display-menu__section-sub">{section.category.nameEn}</p>
                )}
              </div>
              <span className="display-menu__counter">
                {safeIndex + 1} / {sections.length}
              </span>
            </div>

            <ul className="display-menu__list" data-images={settings.showImages ? 'on' : 'off'}>
              {section.items.map((item, index) => (
                <li className="display-menu__item" key={item.id}>
                  {settings.showImages && (
                    <div className="display-menu__thumb" data-tone={tileTone(item.id, 3)}>
                      {item.image ? (
                        <img src={item.image} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <Sparkles className="display-menu__thumb-icon" aria-hidden="true" />
                      )}
                    </div>
                  )}
                  <div className="display-menu__body">
                    <div className="display-menu__name-row">
                      <h3 className="display-menu__dish">{item.name}</h3>
                      {item.badge && <span className="display-menu__badge">{item.badge}</span>}
                      {item.isFeatured && (
                        <span className="display-menu__badge display-menu__badge--gold">مميز</span>
                      )}
                    </div>
                    {item.nameEn && <p className="display-menu__dish-en">{item.nameEn}</p>}
                    {item.description && <p className="display-menu__desc">{item.description}</p>}
                    <div className="display-menu__facts">
                      {item.preparationTimeMinutes ? <span>{item.preparationTimeMinutes} دقيقة</span> : null}
                      {item.calories ? <span>{item.calories} سعرة</span> : null}
                      {index === 0 && section.items.length > 1 ? <span>الأكثر طلباً</span> : null}
                    </div>
                  </div>
                  <div className="display-menu__leader" aria-hidden="true" />
                  <div className="display-menu__price">{formatPrice(item.price, currency)}</div>
                </li>
              ))}
            </ul>

            <p className="display-menu__note">
              الأسعار تشمل ضريبة القيمة المضافة · للطلب يرجى التوجه إلى الكاشير
            </p>
          </div>
        ) : (
          <div className="display-menu__empty">
            <h2 className="display-menu__section-title">القائمة قيد التحديث</h2>
            <p>لا توجد أطباق متاحة للعرض حالياً.</p>
          </div>
        )}

        {/* ---------- Footer watermark ---------- */}
        <footer className="display-menu__foot">
          <span>{restaurantName}</span>
          <span className="display-menu__dot" aria-hidden="true">·</span>
          <span>
            مُدار بواسطة <strong>منصة مريح MUREEH</strong>
          </span>
          {displayUrl && <span className="display-menu__url">{displayUrl.replace(/^https?:\/\//, '')}</span>}
        </footer>

        {/* ---------- Controls (never shown inside a recording when hidden) ---------- */}
        {settings.showControls && (
          <div className="display-menu__controls" role="toolbar" aria-label="أدوات العرض">
            <button
              type="button"
              className="display-menu__btn"
              onClick={() => goTo(safeIndex - 1)}
              disabled={sections.length < 2}
              aria-label="القسم السابق"
            >
              <ChevronRight className="display-menu__btn-icon" />
            </button>
            <button
              type="button"
              className="display-menu__btn display-menu__btn--primary"
              onClick={() => update({ autoplay: !settings.autoplay })}
              aria-label={settings.autoplay ? 'إيقاف العرض التلقائي' : 'تشغيل العرض التلقائي'}
            >
              {settings.autoplay ? (
                <Pause className="display-menu__btn-icon" />
              ) : (
                <Play className="display-menu__btn-icon" />
              )}
            </button>
            <button
              type="button"
              className="display-menu__btn"
              onClick={() => goTo(safeIndex + 1)}
              disabled={sections.length < 2}
              aria-label="القسم التالي"
            >
              <ChevronLeft className="display-menu__btn-icon" />
            </button>

            <span className="display-menu__sep" aria-hidden="true" />

            <button
              type="button"
              className="display-menu__btn"
              onClick={() =>
                update({
                  dwellSeconds: SPEED_OPTIONS[(SPEED_OPTIONS.indexOf(settings.dwellSeconds as 6 | 9 | 14) + 1) % SPEED_OPTIONS.length],
                })
              }
              aria-label="سرعة التنقل"
              title="مدة بقاء كل قسم على الشاشة"
            >
              <Gauge className="display-menu__btn-icon" />
              <span className="display-menu__btn-label">{settings.dwellSeconds}ث</span>
            </button>
            <button
              type="button"
              className="display-menu__btn"
              onClick={() => update({ showImages: !settings.showImages })}
              aria-pressed={settings.showImages}
              title="إظهار أو إخفاء صور الأطباق"
            >
              <Sparkles className="display-menu__btn-icon" />
            </button>
            <button
              type="button"
              className="display-menu__btn"
              onClick={() => setShowQr(true)}
              title="رمز QR لرابط العرض"
            >
              <QrCode className="display-menu__btn-icon" />
            </button>
            <button type="button" className="display-menu__btn" onClick={copyLink} title="نسخ رابط العرض">
              {copied ? (
                <Check className="display-menu__btn-icon" />
              ) : (
                <Link2 className="display-menu__btn-icon" />
              )}
            </button>
            <button
              type="button"
              className="display-menu__btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
            >
              {isFullscreen ? (
                <Minimize2 className="display-menu__btn-icon" />
              ) : (
                <Maximize2 className="display-menu__btn-icon" />
              )}
            </button>
            <button
              type="button"
              className="display-menu__btn"
              onClick={() => update({ showControls: false })}
              title="إخفاء الأدوات (H لإظهارها)"
            >
              <X className="display-menu__btn-icon" />
            </button>

            <div className="display-menu__progress" aria-hidden="true">
              <div className="display-menu__progress-bar" ref={progressRef} />
            </div>
          </div>
        )}

        {!settings.showControls && (
          <button
            type="button"
            className="display-menu__restore"
            onClick={() => update({ showControls: true })}
            title="إظهار الأدوات (H)"
          >
            أدوات العرض
          </button>
        )}

        {showQr && (
          <div className="display-menu__modal" role="dialog" aria-label="رابط العرض">
            <div className="display-menu__modal-card">
              <button
                type="button"
                className="display-menu__modal-close"
                onClick={() => setShowQr(false)}
                aria-label="إغلاق"
              >
                <X className="display-menu__btn-icon" />
              </button>
              <h3>رابط شاشة العرض</h3>
              <p>
                شارك الرابط أو اطبع الرمز لوضعه عند الكاشير — يفتح القائمة للعرض فقط، بدون سلة أو طلب.
              </p>
              <div className="display-menu__qr">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="رمز QR لرابط العرض" width={180} height={180} />
                ) : (
                  <span>تعذر إنشاء الرمز</span>
                )}
              </div>
              <div className="display-menu__link-row">
                <code>{displayUrl}</code>
                <button type="button" className="display-menu__btn" onClick={copyLink}>
                  <Copy className="display-menu__btn-icon" />
                  <span className="display-menu__btn-label">نسخ</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DisplayMenu;
