import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { soundFX } from '../../utils/audio';
import { optimizeImageUrl } from './ProductImage';
import { useBrandTheme } from '../../theme/brandTheme';

/**
 * Restaurant Entry Experience — the layer a guest lands on right after
 * scanning the table QR.
 *
 * RESPONSIBILITY
 * --------------
 * Presentation + motion + interaction only. It renders the tenant's cover
 * photography, asks the guest to open the venue (logo tap), reveals the venue
 * identity, teaches a swipe, and then gets out of the way. Two pieces of
 * chrome are persistent across both beats on purpose: a top context bar
 * (brand, table badge, skip) and a two-step progress rail — the guest always
 * knows where they are, which table they are on, and how far in they are. It
 * owns NO business logic: no session, no table, no cart, no API call. The
 * only thing it hands back to `CustomerLayout` is "the guest is done here"
 * (`onEnter`), which is the same one boolean the previous welcome screen used.
 *
 * DATA
 * ----
 * Everything comes from the existing `useRestaurant()` tenant object —
 * `coverImage`, `logo`, `logoFit`/`logoPosition`, `name`/`nameEn`,
 * `description`, `primaryColor`/`accentColor`, `language`. No new API call, no
 * duplicated restaurant shape, no new data structure.
 *
 * DIRECTION
 * ---------
 * `language` drives the gesture: Arabic reads right-to-left, so the "next"
 * surface sits to the LEFT and the guest drags RIGHT (dragging content right
 * reveals what is on its left). English mirrors it. Arrow, drag, layer movement
 * and exit all read from the same `dirSign`, so none of them can disagree.
 */

interface RestaurantEntryExperienceProps {
  /** Called once the entry layer has finished transitioning away. */
  onEnter: () => void;
}

type EntryStage = 'COVER' | 'IDENTITY';

/** Distance (as a fraction of the sheet width) that counts as "opened". */
const ENTER_RATIO = 0.26;
/** Floor so the gesture stays reachable on very wide screens, and honest on tiny ones. */
const ENTER_MIN_PX = 88;
/** A fast flick counts even if it never reached the distance threshold. px/ms. */
const FLICK_VELOCITY = 0.45;
/** Exit animation budget. Reduced-motion users skip straight to the menu. */
const EXIT_MS = 460;

/**
 * Deterministic ambient motes. A fixed table (no Math.random) keeps server
 * rendering, snapshot tests and the guest's first paint byte-identical, and it
 * keeps the field small enough to read as atmosphere rather than as an effect.
 */
const MOTES: ReadonlyArray<{
  left: number;
  top: number;
  size: number;
  delay: number;
  duration: number;
  driftX: number;
}> = [
  { left: 12, top: 18, size: 3, delay: 0, duration: 17, driftX: 14 },
  { left: 26, top: 62, size: 2, delay: 2.4, duration: 21, driftX: -10 },
  { left: 44, top: 12, size: 4, delay: 1.2, duration: 19, driftX: 9 },
  { left: 58, top: 74, size: 2, delay: 3.1, duration: 24, driftX: -16 },
  { left: 71, top: 28, size: 3, delay: 0.6, duration: 16, driftX: 12 },
  { left: 84, top: 58, size: 2, delay: 4.2, duration: 22, driftX: -8 },
  { left: 33, top: 42, size: 2, delay: 5.5, duration: 26, driftX: 11 },
  { left: 66, top: 86, size: 3, delay: 2.9, duration: 18, driftX: -13 },
  { left: 8, top: 82, size: 2, delay: 6.1, duration: 23, driftX: 7 },
  { left: 92, top: 36, size: 2, delay: 1.8, duration: 20, driftX: -6 },
  { left: 51, top: 92, size: 3, delay: 7.4, duration: 25, driftX: 10 },
  { left: 20, top: 34, size: 2, delay: 8.2, duration: 28, driftX: -9 },
];

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const RestaurantEntryExperience: React.FC<RestaurantEntryExperienceProps> = ({
  onEnter,
}) => {
  const { currentRestaurant, activeTableNumber } = useRestaurant();

  // Tenant palette -> the same `--brand-*` custom properties the menu consumes,
  // so the hand-off into the menu has no colour jump.
  useBrandTheme(currentRestaurant?.primaryColor, currentRestaurant?.accentColor);

  const [reducedMotion, setReducedMotion] = useState<boolean>(prefersReducedMotion);
  const [stage, setStage] = useState<EntryStage>('COVER');
  const [coverReady, setCoverReady] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [shift, setShift] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    // Safari < 14 only has the deprecated listener API.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  // -------------------------------------------------------------------------
  // Data (all from the existing tenant object — never hard-coded)
  // -------------------------------------------------------------------------
  const isEnglish = currentRestaurant?.language === 'en';
  const isRTL = !isEnglish;
  /** +1 = the gesture travels right (RTL), -1 = left (LTR). */
  const dirSign = isRTL ? 1 : -1;

  const displayName = useMemo(() => {
    if (!currentRestaurant) return '';
    const arabic = currentRestaurant.name;
    const english = currentRestaurant.nameEn || currentRestaurant.name;
    return isEnglish ? english : arabic;
  }, [currentRestaurant, isEnglish]);

  // An empty description is omitted entirely — no invented copy.
  const description = (currentRestaurant?.description || '').trim();
  const coverSrc = useMemo(() => {
    const raw = (currentRestaurant?.coverImage || '').trim();
    return raw ? optimizeImageUrl(raw, 1600, 80) : '';
  }, [currentRestaurant?.coverImage]);
  const logoSrc = (currentRestaurant?.logo || '').trim();
  const showCover = Boolean(coverSrc) && !coverFailed;
  const monogram = (currentRestaurant?.nameEn || currentRestaurant?.name || 'م')
    .trim()
    .charAt(0)
    .toUpperCase();

  // -------------------------------------------------------------------------
  // Entering the menu
  // -------------------------------------------------------------------------
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    []
  );

  const completeEntry = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setDragging(false);
    // Reduced motion: no exit choreography to sit through, but the callback is
    // still deferred a frame so the state flush paints before the menu mounts.
    const delay = reducedMotion ? 0 : EXIT_MS;
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      onEnter();
    }, delay);
  }, [exiting, onEnter, reducedMotion]);

  const handleReveal = useCallback(() => {
    if (stage !== 'COVER') return;
    setStage('IDENTITY');
    soundFX.playTap();
  }, [stage]);

  // -------------------------------------------------------------------------
  // Drag: the sheet tracks the finger 1:1 and leaves in the gesture direction.
  // -------------------------------------------------------------------------
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startTime: number;
    axis: 'unknown' | 'horizontal' | 'vertical';
  }>({ pointerId: null, startX: 0, startY: 0, startTime: 0, axis: 'unknown' });

  // Width is measured after mount (never during render), so the threshold
  // adapts to the real viewport from 360px phones up to desktop widths.
  const [sheetWidth, setSheetWidth] = useState(0);
  useEffect(() => {
    const node = sheetRef.current;
    if (!node) return;
    const measure = () => setSheetWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const thresholdPx = Math.max(ENTER_MIN_PX, sheetWidth * ENTER_RATIO);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (stage !== 'IDENTITY' || exiting) return;
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: event.timeStamp,
        axis: 'unknown',
      };
      setDragging(true);
      // Capture keeps the gesture alive when the finger outruns the element.
      const node = event.currentTarget;
      if (typeof node.setPointerCapture === 'function') {
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          /* capture is best-effort (synthetic events in tests have no pointer) */
        }
      }
    },
    [exiting, stage]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!dragging || g.pointerId !== event.pointerId) return;

      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;

      // Decide the axis once, then honour it: a vertical intent is left to the
      // browser so the sheet never steals a scroll.
      if (g.axis === 'unknown') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      if (g.axis === 'vertical') return;

      // travel is measured in the "open the menu" direction; the sheet
      // itself lives in screen space, so it must be multiplied back by
      // dirSign or an LTR tenant would watch the sheet flee the finger.
      const travel = dx * dirSign;
      if (travel <= 0) {
        // Dragging backwards is allowed but resists: the sheet feels attached
        // without letting the guest pull the wrong way open.
        setShift(Math.max(travel * 0.28, -48) * dirSign);
        return;
      }
      setShift(Math.min(travel, thresholdPx * 1.4) * dirSign);
    },
    [dirSign, dragging, thresholdPx]
  );

  const endGesture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!dragging || g.pointerId !== event.pointerId) return;

      const elapsed = Math.max(1, event.timeStamp - g.startTime);
      const velocity = ((event.clientX - g.startX) * dirSign) / elapsed; // px/ms
      // shift is screen-space; convert back to gesture-direction px so the
      // distance test is identical for RTL and LTR tenants.
      const travelled = shift * dirSign;

      gesture.current = {
        pointerId: null,
        startX: 0,
        startY: 0,
        startTime: 0,
        axis: 'unknown',
      };
      setDragging(false);

      if (travelled >= thresholdPx || velocity >= FLICK_VELOCITY) {
        completeEntry();
        return;
      }
      // Below threshold: the sheet returns. Nothing was committed, so the
      // guest's cover image and identity are exactly where they were.
      setShift(0);
    },
    [completeEntry, dirSign, dragging, shift, thresholdPx]
  );

  // Swipe is the primary gesture, never the only one: a real button carries
  // keyboard, screen-reader and single-tap users to the same place.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        completeEntry();
        return;
      }
      // The arrow that matches the swipe direction opens the menu.
      const forwardKey = dirSign === 1 ? 'ArrowRight' : 'ArrowLeft';
      if (event.key === forwardKey) {
        event.preventDefault();
        completeEntry();
      }
    },
    [completeEntry, dirSign]
  );

  // Gesture-direction progress (0..1), independent of which way the sheet
  // actually travels on screen.
  const progress = clamp((shift * dirSign) / Math.max(1, thresholdPx), 0, 1);
  const revealed = stage === 'IDENTITY';

  return (
    <div
      className="entry-root"
      role="dialog"
      aria-modal="true"
      aria-label={displayName ? `مدخل ${displayName}` : 'مدخل المطعم'}
      dir={isRTL ? 'rtl' : 'ltr'}
      onKeyDown={handleKeyDown}
      data-stage={stage}
      data-exiting={exiting ? 'true' : 'false'}
    >
      <div
        ref={sheetRef}
        className={`entry-sheet${dragging ? '' : ' entry-sheet--snap'}${
          exiting ? ' entry-sheet--exiting' : ''
        }`}
        style={{
          // One custom property drives the whole layer so the transform is
          // written once per frame instead of re-composing class names.
          ['--entry-shift' as string]: `${shift.toFixed(1)}px`,
          ['--entry-dir' as string]: String(dirSign),
          ['--entry-progress' as string]: progress.toFixed(3),
          // Letter-spacing is a Latin-script device: it visibly breaks the
          // connected strokes of Arabic, so Arabic tenants get zero spacing
          // on the same elements.
          ['--entry-ls' as string]: isEnglish ? '0.08em' : '0em',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        {/* --------------------------------------------------------------- */}
        {/* Cinematic cover: the restaurant's own photography is the hero.  */}
        {/* --------------------------------------------------------------- */}
        <div className="entry-cover" aria-hidden={!showCover}>
          {showCover ? (
            <img
              className={`entry-cover__img${coverReady ? ' entry-cover__img--ready' : ''}`}
              src={coverSrc}
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
              draggable={false}
              onLoad={() => setCoverReady(true)}
              onError={() => setCoverFailed(true)}
            />
          ) : (
            // No cover (or it failed): a brand-built ambience rather than a
            // generic placeholder, so the venue still feels like itself.
            <div className="entry-cover__fallback" />
          )}

          <div className="entry-cover__scrim" aria-hidden="true" />
          <div className="entry-cover__vignette" aria-hidden="true" />
          {!reducedMotion && <div className="entry-cover__sweep" aria-hidden="true" />}

          {/* Atmosphere: a handful of slow motes, never a particle system. */}
          {!reducedMotion && (
            <div className="entry-motes" aria-hidden="true">
              {MOTES.map((mote, index) => (
                <span
                  key={index}
                  className="entry-mote"
                  style={{
                    left: `${mote.left}%`,
                    top: `${mote.top}%`,
                    width: `${mote.size}px`,
                    height: `${mote.size}px`,
                    animationDelay: `${mote.delay}s`,
                    animationDuration: `${mote.duration}s`,
                    ['--entry-mote-drift' as string]: `${mote.driftX}px`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* --------------------------------------------------------------- */}
        {/* Persistent context bar — WHO the guest just entered, WHICH      */}
        {/* table the QR belongs to, and a one-tap skip. It lives OUTSIDE   */}
        {/* the stages so it stays put while the two beats cross-fade,      */}
        {/* which is what reads as "one composed screen", not two screens.  */}
        {/* --------------------------------------------------------------- */}
        <div className="entry-topbar">
          <span className="entry-topbar__brand">
            <span className="entry-topbar__crest" aria-hidden="true">
              {logoSrc ? (
                <img
                  className="entry-topbar__crest-img"
                  src={logoSrc}
                  alt=""
                  decoding="async"
                  draggable={false}
                  style={{
                    objectFit: currentRestaurant?.logoFit === 'contain' ? 'contain' : 'cover',
                    objectPosition: currentRestaurant?.logoPosition || '50% 50%',
                  }}
                />
              ) : (
                <span className="entry-topbar__monogram">{monogram}</span>
              )}
            </span>
            <span className="entry-topbar__name">{displayName}</span>
          </span>

          <span className="entry-topbar__actions">
            {activeTableNumber != null && (
              <span className="entry-topbar__table" dir="ltr">
                {isEnglish ? `Table ${activeTableNumber}` : `طاولة ${activeTableNumber}`}
              </span>
            )}
            <button
              type="button"
              className="entry-topbar__skip"
              onClick={completeEntry}
              aria-label={
                isEnglish
                  ? 'Skip the introduction and open the menu'
                  : 'تخطي مقدمة المطعم والدخول مباشرة إلى القائمة'
              }
            >
              <span>{isEnglish ? 'Skip' : 'تخطي'}</span>
              <svg
                className="entry-topbar__skip-arrow"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M9 5.5 L15.5 12 L9 18.5" />
              </svg>
            </button>
          </span>
        </div>

        {/* --------------------------------------------------------------- */}
        {/* Stage 1 — the logo is the invitation.                          */}
        {/* --------------------------------------------------------------- */}
        <div className="entry-stage entry-stage--cover" data-active={stage === 'COVER'}>
          <div className="entry-invite">
            <div className="entry-invite__lead">
              <p className="entry-eyebrow">{isEnglish ? 'Welcome' : 'أهلاً بكم'}</p>
              {stage === 'COVER' && (
                <button
                  type="button"
                  onClick={handleReveal}
                  className="entry-logo-button"
                  aria-label={
                    displayName ? `المس للدخول إلى قائمة ${displayName}` : 'المس للدخول إلى القائمة'
                  }
                >
                <span className="entry-logo__halo" aria-hidden="true" />
                {!reducedMotion && <span className="entry-logo__ring" aria-hidden="true" />}
                <span className="entry-logo__disc">
                  {logoSrc ? (
                    <img
                      className="entry-logo__img"
                      src={logoSrc}
                      alt=""
                      decoding="async"
                      draggable={false}
                      style={{
                        objectFit: currentRestaurant?.logoFit === 'contain' ? 'contain' : 'cover',
                        objectPosition: currentRestaurant?.logoPosition || '50% 50%',
                      }}
                    />
                  ) : (
                    <span className="entry-logo__monogram" aria-hidden="true">
                      {monogram}
                    </span>
                  )}
                </span>
              </button>
              )}
            </div>

            <p className="entry-invite__hint">
              {isEnglish ? 'Tap the logo to continue' : 'المس الشعار للمتابعة'}
            </p>
          </div>
        </div>

        {/* --------------------------------------------------------------- */}
        {/* Stage 2 — identity + restaurant-specific composition + arrow.   */}
        {/* --------------------------------------------------------------- */}
        <div className="entry-stage entry-stage--identity" data-active={revealed}>
          {/* Geometry is drawn from the tenant palette, so the venue reads as
              its own world rather than a platform template. The composition
              is a single soft glow now — the former ring set crossed the
              identity text and read as clutter, not as atmosphere. */}
          <div className="entry-composition" aria-hidden="true">
            <span className="entry-composition__glow" />
          </div>

          <div className="entry-identity">
            <span className="entry-identity__crest">
              {logoSrc ? (
                <img
                  className="entry-identity__logo"
                  src={logoSrc}
                  alt=""
                  decoding="async"
                  draggable={false}
                  style={{
                    objectFit: currentRestaurant?.logoFit === 'contain' ? 'contain' : 'cover',
                    objectPosition: currentRestaurant?.logoPosition || '50% 50%',
                  }}
                />
              ) : (
                <span className="entry-logo__monogram" aria-hidden="true">
                  {monogram}
                </span>
              )}
            </span>

            {/* The table badge now lives in the persistent top bar, so the
                identity block reads as a single centred composition. */}
            <p className="entry-eyebrow entry-eyebrow--identity">
              {isEnglish ? 'WELCOME TO' : 'أهلاً بكم في'}
            </p>

            <h1 className="entry-identity__name">{displayName}</h1>

            {/* Omitted entirely when the tenant has no description. */}
            {description && <p className="entry-identity__desc">{description}</p>}
          </div>

          {/* Hollow, dimensional arrow — a floating object, not a button. */}
          <div className="entry-arrow-wrap" aria-hidden="true">
            <div className="entry-arrow__float">
              <div className="entry-arrow__gesture">
                <svg
                  className="entry-arrow"
                  viewBox="0 0 88 56"
                  role="presentation"
                  focusable="false"
                >
                  <defs>
                    <linearGradient id="entry-arrow-face" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(255 255 255 / 0.92)" />
                      <stop offset="45%" stopColor="var(--brand-primary-strong)" />
                      <stop offset="100%" stopColor="var(--brand-accent-strong)" />
                    </linearGradient>
                    <linearGradient id="entry-arrow-sheen" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="rgb(255 255 255 / 0.85)" />
                      <stop offset="55%" stopColor="rgb(255 255 255 / 0.08)" />
                      <stop offset="100%" stopColor="rgb(255 255 255 / 0)" />
                    </linearGradient>
                  </defs>

                  {/* Extruded body: an offset copy reads as thickness. */}
                  <path
                    className="entry-arrow__depth"
                    d="M10 24 H54 V14 L78 29 L54 44 V34 H10 Z"
                  />
                  {/* Hollow face: stroked, never filled. */}
                  <path
                    className="entry-arrow__face"
                    d="M10 24 H54 V14 L78 29 L54 44 V34 H10 Z"
                  />
                  {/* Specular edge, inset so the interior stays empty. */}
                  <path
                    className="entry-arrow__sheen"
                    d="M13 27 H51 V19.5 L70 29 L51 38.5 V31 H13 Z"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Swipe is the primary gesture; it is never the only one. The hint is
              decorative — the real button carries keyboard, screen-reader and
              single-tap guests to exactly the same place. */}
          <div className="entry-action">
            <p className="entry-action__hint" aria-hidden="true">
              {isEnglish ? 'Swipe to continue' : 'اسحب للمتابعة'}
            </p>
            <button type="button" className="entry-action__button" onClick={completeEntry}>
              <span className="entry-action__label">
                {isEnglish ? 'Browse the menu' : 'تصفّح القائمة'}
              </span>
              <svg
                className="entry-action__chevron"
                viewBox="0 0 24 24"
                role="presentation"
                focusable="false"
                aria-hidden="true"
              >
                <path d="M9 5.5 L15.5 12 L9 18.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* --------------------------------------------------------------- */}
        {/* Two-step rail — which beat the guest is on. Persistent across   */}
        {/* both stages (like the top bar), so the flow reads as one        */}
        {/* composed journey: invitation, then identity, then the menu.     */}
        {/* --------------------------------------------------------------- */}
        <div className="entry-progress" aria-hidden="true">
          <span className="entry-progress__label">01</span>
          <span className="entry-progress__seg" data-active={stage === 'COVER'} />
          <span className="entry-progress__seg" data-active={revealed} />
          <span className="entry-progress__label">02</span>
        </div>

        {/* Persistent platform credit — the smallest element of the layer:
            it supports the restaurant brand rather than competing with it. */}
        <p className="entry-credit">{isEnglish ? 'Powered by Mureeh' : 'مدعوم بـ MUREEH'}</p>
      </div>
    </div>
  );
};

export default RestaurantEntryExperience;
