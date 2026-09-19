import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, Product, Restaurant } from '../../types/restaurant';
import { useBrandTheme } from '../../theme/brandTheme';
import { normalizeWhatsappNumber } from '../../utils/whatsapp';
import { generateQrDataUrl } from '../../utils/qrCodeGenerator';
import {
  SOCIAL_FORMATS,
  canvasToBlob,
  getFormat,
  isRecordingSupported,
  loadPosterImages,
  posterFilename,
  recordMenuClip,
  renderPosterCanvas,
  triggerDownload,
  type PosterInput,
  type SocialFormat,
} from '../../utils/socialExport';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
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
  Camera,
  Download,
  Film,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  buildLiveScenes,
  buildLiveSections,
  resolveLiveProfile,
  sectionBackdrop,
  type LiveScene,
  type LiveSection,
} from './liveMenuModel';
import { useLiveSequence } from './useLiveSequence';
import {
  LiveBoardScene,
  LiveCategoryScene,
  LiveIntroScene,
  LiveOutroScene,
  LiveSpotlightScene,
  type SceneChrome,
} from './LiveScenes';
import { LiveReserveCta, LiveReservationPanel } from './LiveReservation';

/**
 * Live Menu stage — the whole signage experience as a PRESENTATION component.
 * ============================================================================
 * Everything the screen needs arrives through props, so this file holds no
 * context, no data fetching and no tenant lookup: `DisplayMenu` binds it to
 * the restaurant context, and the design preview (`preview/livemenu.html`)
 * binds it to sample venues to prove the identity system adapts.
 *
 * Read-only by construction: no cart, no add-to-cart, no quantities, no
 * ordering affordance. The one interaction is «احجز طاولتك», which hands a
 * reservation REQUEST to the venue's WhatsApp — the venue confirms, the
 * platform never claims a booking.
 *
 * Built to run for hours on a wall panel: one rAF clock, no per-frame React
 * state, the clock paused while the tab is hidden, next-scene imagery
 * prefetched and released, every listener/timer released on unmount.
 */

export type LiveMenuToast = (type: 'success' | 'info' | 'warning' | 'error', title: string, message?: string) => void;

export interface LiveMenuStageProps {
  restaurant: Restaurant | null;
  categories: Category[];
  products: Product[];
  onToast: LiveMenuToast;
}

interface DisplaySettings {
  autoplay: boolean;
  /** Playback pace: <1 rushes, >1 lingers. */
  pace: number;
  showImages: boolean;
  showControls: boolean;
}

const PACE_OPTIONS = [
  { value: 0.8, label: 'أسرع' },
  { value: 1, label: 'عادي' },
  { value: 1.3, label: 'أهدأ' },
] as const;

const DISPLAY_FALLBACK: DisplaySettings = {
  autoplay: true,
  pace: 1,
  showImages: true,
  showControls: true,
};

const BUSINESS_LABELS: Record<string, string> = {
  RESTAURANT: 'مطعم',
  CAFE: 'كافيه',
  BAKERY: 'مخبز ومعجنات',
};

const useClock = (enabled: boolean): string => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
};

export const LiveMenuStage: React.FC<LiveMenuStageProps> = ({
  restaurant: currentRestaurant,
  categories,
  products,
  onToast: showToast,
}) => {

  // Same tenant palette the ordering menu uses — the display never diverges.
  // (Also keeps the `--brand-*` variables on <html> for the export canvas.)
  useBrandTheme(currentRestaurant?.primaryColor, currentRestaurant?.accentColor);

  const [settings, setSettings] = useState<DisplaySettings>(DISPLAY_FALLBACK);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<SocialFormat['id']>('story');
  const [exportBusy, setExportBusy] = useState<'png' | 'clip' | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const anyOverlay = showQr || showExport || reserveOpen;
  const clock = useClock(!settings.showControls && !anyOverlay);

  // ---------------------------------------------------------------------
  // Model: sections → visual profile → scene timeline
  // ---------------------------------------------------------------------
  const sections: LiveSection[] = useMemo(
    () => buildLiveSections(categories, products),
    [categories, products]
  );

  const profileKey = `${currentRestaurant?.primaryColor || ''}|${currentRestaurant?.accentColor || ''}|${currentRestaurant?.businessType || ''}`;
  const profile = useMemo(
    () => resolveLiveProfile(currentRestaurant, sections),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, sections]
  );

  const pacedScenes: LiveScene[] = useMemo(() => {
    let scenes = buildLiveScenes(sections, { profile });
    // «إخفاء الصور» is a real presentation choice (a printed-menu look, or a
    // venue whose photography is not ready). It removes the film's image beats
    // rather than leaving empty frames: no spotlights, no hero panels, no
    // backdrops — the boards become type-led with dotted leaders.
    if (!settings.showImages) {
      scenes = scenes
        .filter((candidate) => candidate.kind !== 'spotlight')
        .map((candidate) =>
          candidate.kind === 'board'
            ? { ...candidate, heroes: [] }
            : { ...candidate, image: undefined }
        );
    }
    if (settings.pace === 1) return scenes;
    return scenes.map((scene) => ({
      ...scene,
      durationMs: Math.max(2400, Math.round(scene.durationMs * settings.pace)),
    }));
  }, [sections, profile, settings.pace, settings.showImages]);

  const { scene, progressRef, goTo, next, prev } = useLiveSequence(pacedScenes, {
    playing: settings.autoplay,
    hold: anyOverlay,
  });

  const update = useCallback((patch: Partial<DisplaySettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // ---------------------------------------------------------------------
  // Chrome
  // ---------------------------------------------------------------------
  const currency = currentRestaurant?.currency || '₪';
  const restaurantName = currentRestaurant?.name || 'المطعم';
  const restaurantNameEn = currentRestaurant?.nameEn || '';
  const chrome: SceneChrome = { restaurantName, restaurantNameEn, currency };
  const businessLabel =
    BUSINESS_LABELS[currentRestaurant?.businessType || 'RESTAURANT'] || 'مطعم';

  const brandBackdrop = settings.showImages
    ? currentRestaurant?.coverImage ||
      currentRestaurant?.galleryImages?.[0] ||
      sectionBackdrop(sections[0])
    : undefined;

  const logo = currentRestaurant?.logo || '';
  const whatsappNumber = useMemo(
    () => normalizeWhatsappNumber(currentRestaurant?.whatsappNumber) || '',
    [currentRestaurant?.whatsappNumber]
  );
  const canReserve = whatsappNumber.length > 0;

  const displayUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = currentRestaurant?.slug || 'mureeh';
    return `${window.location.origin}/r/${slug}?view=display`;
  }, [currentRestaurant?.slug]);

  // ---------------------------------------------------------------------
  // Fullscreen + keyboard (stable handlers, one listener each)
  // ---------------------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Refs keep the key handler stable so the listener is bound once per mount
  // instead of on every render (the previous board re-bound it every frame).
  const keyStateRef = useRef({ anyOverlay, settings, next, prev, toggleFullscreen });
  keyStateRef.current = { anyOverlay, settings, next, prev, toggleFullscreen };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = keyStateRef.current;
      if (state.anyOverlay) {
        if (event.key === 'Escape') return; // the dialog owns Escape
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === 'ArrowLeft') state.next();
      else if (event.key === 'ArrowRight') state.prev();
      else if (event.key === ' ') {
        event.preventDefault();
        setSettings((prev) => ({ ...prev, autoplay: !prev.autoplay }));
      } else if (key === 'f') state.toggleFullscreen();
      else if (key === 'h') setSettings((prev) => ({ ...prev, showControls: !prev.showControls }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------------
  // Social export: the same menu, painted onto a canvas at publish ratios.
  // ---------------------------------------------------------------------
  const activeSectionIndex = scene && scene.sectionIndex >= 0 ? scene.sectionIndex : 0;

  const buildPosterInput = useCallback(
    (sectionIndex: number, progress = 1): PosterInput | null => {
      const target = sections[sectionIndex];
      if (!target) return null;
      return {
        restaurantName,
        restaurantNameEn: currentRestaurant?.nameEn,
        tagline: currentRestaurant?.description,
        primaryColor: currentRestaurant?.primaryColor,
        accentColor: currentRestaurant?.accentColor,
        currency,
        section: {
          name: target.category.name,
          nameEn: target.category.nameEn,
          dishes: target.items.map((item) => ({
            id: item.id,
            name: item.name,
            nameEn: item.nameEn,
            description: item.description,
            price: item.price,
            badge: item.badge,
            isFeatured: item.isFeatured,
          })),
        },
        sectionIndex: sectionIndex + 1,
        sectionCount: sections.length,
        note: 'الأسعار تشمل ضريبة القيمة المضافة',
        url: displayUrl,
        progress,
      };
    },
    [sections, currentRestaurant, currency, displayUrl, restaurantName]
  );

  const attachImages = useCallback(
    async (input: PosterInput, sectionIndex: number): Promise<PosterInput> => {
      const items = sections[sectionIndex]?.items || [];
      const images = await loadPosterImages(items);
      if (images.size === 0) return input;
      return {
        ...input,
        section: {
          ...input.section,
          dishes: input.section.dishes.map((dish) => ({ ...dish, image: images.get(dish.id) })),
        },
      };
    },
    [sections]
  );

  const handleDownloadPoster = useCallback(async () => {
    const input = buildPosterInput(activeSectionIndex);
    if (!input) return;
    setExportBusy('png');
    setExportError('');
    try {
      const withImages = await attachImages(input, activeSectionIndex);
      const format = getFormat(exportFormat);
      const canvas = renderPosterCanvas(withImages, format);
      const blob = await canvasToBlob(canvas);
      triggerDownload(blob, posterFilename(withImages, format));
      showToast('success', 'تم تنزيل الصورة', `${format.ratio} · ${format.width}×${format.height}`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'تعذر تصدير الصورة');
    } finally {
      setExportBusy(null);
    }
  }, [buildPosterInput, attachImages, activeSectionIndex, exportFormat, showToast]);

  const handleRecordClip = useCallback(async () => {
    if (sections.length === 0) return;
    const format = getFormat(exportFormat);
    setExportBusy('clip');
    setExportError('');
    setExportProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const inputs: PosterInput[] = [];
      for (let i = 0; i < sections.length; i += 1) {
        const input = buildPosterInput(i);
        if (input) inputs.push(await attachImages(input, i));
      }
      const clip = await recordMenuClip(inputs, {
        format,
        secondsPerSection: 3.5,
        onProgress: (ratio) => setExportProgress(ratio),
        signal: controller.signal,
      });
      triggerDownload(clip.blob, clip.filename);
      showToast('success', 'تم تسجيل المقطع', `${clip.durationSeconds} ثانية · ${format.ratio}`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'تعذر تسجيل المقطع');
    } finally {
      abortRef.current = null;
      setExportBusy(null);
      setExportProgress(0);
    }
  }, [buildPosterInput, attachImages, sections.length, exportFormat, showToast]);

  const handleStopRecording = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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

  const paceIndex = PACE_OPTIONS.findIndex((option) => option.value === settings.pace);
  const activeSection = scene && scene.sectionIndex >= 0 ? sections[scene.sectionIndex] : undefined;

  return (
    <div
      className="display-menu"
      dir="rtl"
      data-testid="display-menu"
      data-motion={profile.displayFace === 'serif' ? 'editorial' : 'vivid'}
      style={profile.vars as React.CSSProperties}
    >
      {/* Ambient brand field: tinted by the venue's own hue, animated on the
          compositor only (transform/opacity), so it costs nothing per frame. */}
      <div className="display-menu__ambient" aria-hidden="true">
        <span className="display-menu__ambient-glow display-menu__ambient-glow--a" />
        <span className="display-menu__ambient-glow display-menu__ambient-glow--b" />
        <span className="display-menu__ambient-grain" />
        <span className="display-menu__ambient-vignette" />
      </div>

      <div className="display-menu__stage">
        {/* ---------- Persistent chrome: the venue is always on screen ---------- */}
        <header className="display-menu__header">
          <div className="display-menu__brand">
            <span className="display-menu__crest display-menu__crest--chrome" aria-hidden="true">
              {logo ? <img src={logo} alt="" /> : <MonitorPlay className="display-menu__crest-icon" />}
            </span>
            <div className="display-menu__titles">
              <h1 className="display-menu__name display-menu__name--chrome">{restaurantName}</h1>
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

        {/* ---------- The film ---------- */}
        <div className="display-menu__scenes" aria-live="off">
          {scene ? (
            <React.Fragment key={scene.id}>
              {scene.kind === 'intro' && (
                <LiveIntroScene
                  scene={scene}
                  chrome={chrome}
                  backdrop={brandBackdrop}
                  logo={logo}
                  tagline={currentRestaurant?.description}
                  businessLabel={businessLabel}
                />
              )}
              {scene.kind === 'category' && <LiveCategoryScene scene={scene} chrome={chrome} />}
              {scene.kind === 'spotlight' && (
                <LiveSpotlightScene scene={scene} chrome={chrome} />
              )}
              {scene.kind === 'board' && (
                <LiveBoardScene
                  scene={scene}
                  chrome={chrome}
                  leaders={profile.layout === 'type-led'}
                />
              )}
              {scene.kind === 'outro' && (
                <LiveOutroScene
                  scene={scene}
                  chrome={chrome}
                  backdrop={brandBackdrop}
                  logo={logo}
                  displayUrl={displayUrl}
                  canReserve={canReserve}
                />
              )}
            </React.Fragment>
          ) : (
            <div className="display-menu__empty">
              <h2 className="display-menu__section-title">القائمة قيد التحديث</h2>
              <p>لا توجد أطباق متاحة للعرض حالياً.</p>
            </div>
          )}
        </div>

        {/* ---------- Section rail: where we are in the menu ---------- */}
        {sections.length > 0 && (
          <nav className="display-menu__rail" aria-label="أقسام القائمة">
            <span className="display-menu__counter">
              {scene?.ordinal ?? 1} / {sections.length}
            </span>
            <ol className="display-menu__dots">
              {sections.map((section, sectionIndex) => (
                <li key={section.category.id}>
                  <button
                    type="button"
                    className="display-menu__dot"
                    data-active={scene?.sectionIndex === sectionIndex ? 'true' : 'false'}
                    onClick={() => {
                      const target = pacedScenes.findIndex(
                        (candidate) =>
                          candidate.sectionIndex === sectionIndex && candidate.kind === 'category'
                      );
                      if (target >= 0) goTo(target);
                    }}
                    aria-label={`الانتقال إلى قسم ${section.category.name}`}
                    title={section.category.name}
                  />
                </li>
              ))}
            </ol>
            <span className="display-menu__rail-label">{activeSection?.category.name}</span>
          </nav>
        )}

        {/* ---------- The one and only CTA ---------- */}
        {canReserve && (
          <LiveReserveCta
            restaurantName={restaurantName}
            whatsappNumber={whatsappNumber}
            onOpen={() => setReserveOpen(true)}
            hidden={anyOverlay}
          />
        )}

        {/* ---------- Footer watermark ---------- */}
        <footer className="display-menu__foot">
          <span>{restaurantName}</span>
          <span className="display-menu__dot-sep" aria-hidden="true">
            ·
          </span>
          <span>
            مُدار بواسطة <strong>منصة مريح MUREEH</strong>
          </span>
          {displayUrl && (
            <span className="display-menu__url">{displayUrl.replace(/^https?:\/\//, '')}</span>
          )}
        </footer>

        {/* ---------- Controls (hidden while recording) ---------- */}
        {settings.showControls && (
          <div className="display-menu__controls" role="toolbar" aria-label="أدوات العرض">
            <button
              type="button"
              className="display-menu__btn"
              onClick={prev}
              disabled={pacedScenes.length < 2}
              aria-label="المشهد السابق"
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
              onClick={next}
              disabled={pacedScenes.length < 2}
              aria-label="المشهد التالي"
            >
              <ChevronLeft className="display-menu__btn-icon" />
            </button>

            <span className="display-menu__sep" aria-hidden="true" />

            <button
              type="button"
              className="display-menu__btn"
              onClick={() =>
                update({ pace: PACE_OPTIONS[(paceIndex + 1) % PACE_OPTIONS.length].value })
              }
              aria-label="سرعة العرض"
              title="إيقاع التنقل بين المشاهد"
            >
              <Gauge className="display-menu__btn-icon" />
              <span className="display-menu__btn-label">
                {PACE_OPTIONS[paceIndex < 0 ? 1 : paceIndex].label}
              </span>
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
              className="display-menu__btn display-menu__btn--accent"
              onClick={() => setShowExport(true)}
              title="تصدير للسوشيال ميديا"
            >
              <Camera className="display-menu__btn-icon" />
              <span className="display-menu__btn-label">تصدير</span>
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

        {canReserve && (
          <LiveReservationPanel
            isOpen={reserveOpen}
            restaurantName={restaurantName}
            whatsappNumber={whatsappNumber}
            onClose={() => setReserveOpen(false)}
          />
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

        {showExport && (
          <div className="display-menu__modal" role="dialog" aria-label="تصدير للسوشيال ميديا">
            <div className="display-menu__modal-card display-menu__modal-card--wide">
              <button
                type="button"
                className="display-menu__modal-close"
                onClick={() => {
                  abortRef.current?.abort();
                  setShowExport(false);
                }}
                aria-label="إغلاق"
              >
                <X className="display-menu__btn-icon" />
              </button>

              <h3>تصدير لمواقع التواصل</h3>
              <p>
                صورة أو مقطع جاهز للنشر بألوان مطعمك — يُنشأ داخل المتصفح بدون رفع أي بيانات.
                {sections.length > 0 ? ` المقطع يمر على ${sections.length} أقسام.` : ''}
              </p>

              <div className="display-menu__formats" role="radiogroup" aria-label="مقاس النشر">
                {SOCIAL_FORMATS.filter((f) => f.id !== 'reel').map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    role="radio"
                    aria-checked={exportFormat === format.id}
                    className={`display-menu__format${exportFormat === format.id ? ' is-active' : ''}`}
                    onClick={() => setExportFormat(format.id)}
                    disabled={exportBusy !== null}
                  >
                    <span
                      className="display-menu__format-shape"
                      data-shape={format.id}
                      aria-hidden="true"
                    />
                    <span className="display-menu__format-name">{format.label}</span>
                    <span className="display-menu__format-ratio">{format.ratio}</span>
                  </button>
                ))}
              </div>

              <div className="display-menu__actions">
                <button
                  type="button"
                  className="display-menu__btn display-menu__btn--primary display-menu__btn--wide"
                  onClick={handleDownloadPoster}
                  disabled={exportBusy !== null || sections.length === 0}
                >
                  {exportBusy === 'png' ? (
                    <Loader2 className="display-menu__btn-icon display-menu__spin" />
                  ) : (
                    <Download className="display-menu__btn-icon" />
                  )}
                  <span className="display-menu__btn-label">
                    {exportBusy === 'png' ? 'جارٍ التصدير…' : `تنزيل صورة ${activeSection?.category.name || ''}`}
                  </span>
                </button>

                <button
                  type="button"
                  className="display-menu__btn display-menu__btn--wide"
                  onClick={exportBusy === 'clip' ? handleStopRecording : handleRecordClip}
                  disabled={(exportBusy !== null && exportBusy !== 'clip') || sections.length === 0}
                  title={isRecordingSupported() ? '' : 'التسجيل غير مدعوم في هذا المتصفح'}
                >
                  {exportBusy === 'clip' ? (
                    <Loader2 className="display-menu__btn-icon display-menu__spin" />
                  ) : (
                    <Film className="display-menu__btn-icon" />
                  )}
                  <span className="display-menu__btn-label">
                    {exportBusy === 'clip'
                      ? `تسجيل… ${Math.round(exportProgress * 100)}% (إيقاف)`
                      : 'تسجيل مقطع فيديو'}
                  </span>
                </button>
              </div>

              {exportBusy === 'clip' && (
                <div className="display-menu__progress display-menu__progress--inline" aria-hidden="true">
                  <div
                    className="display-menu__progress-bar"
                    style={{ width: `${Math.round(exportProgress * 100)}%` }}
                  />
                </div>
              )}

              {exportError && (
                <p className="display-menu__error">
                  <AlertCircle className="display-menu__btn-icon" />
                  {exportError}
                </p>
              )}

              {!isRecordingSupported() && (
                <p className="display-menu__hint">
                  تسجيل الفيديو يحتاج متصفحاً يدعم MediaRecorder (Chrome أو Edge). تنزيل الصور يعمل في كل المتصفحات.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveMenuStage;
