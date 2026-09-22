import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChefHat,
  Coffee,
  Croissant,
  Hand,
  LayoutGrid,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { useRestaurant } from '../../context/RestaurantContext';
import { soundFX } from '../../utils/audio';
import { optimizeImageUrl } from './ProductImage';

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
 *
 * COMPOSITION
 * -----------
 * One symmetrical editorial column, read top to bottom: atmosphere (the
 * venue's own photograph, held inside a hairline frame), then the mark, the
 * greeting, the display name with its tracked Latin lockup, a single
 * ornamental divider, the venue's own copy, the fact strip, and finally the
 * gesture. Depth is layered rather than drawn — photograph, scrim, atmosphere,
 * frame, content — which is what makes a phone screen read as a composed
 * poster instead of as a stack of cards.
 *
 * TYPE
 * ----
 * `--font-serif` and `--font-sans` are the theme's typography knobs and this
 * layer reads them verbatim: no family is named here, so a theme that changes
 * its display face re-types the whole page, and no restaurant's identity is
 * baked in. Hierarchy comes from size, tracking and tone — never from weight
 * alone — and every tracking rule is gated to Latin (either by direction or by
 * a name that carries no Arabic glyphs), because letter-spacing breaks
 * connected Arabic script.
 *
 * LIGHT / DARK
 * ------------
 * The canvas stays dark on purpose. The tenant palette is DERIVED for a dark
 * surface (`--brand-soft`, `--brand-line`, `--brand-muted`, `--brand-ink` in
 * theme/brandTheme), the menu behind this layer is `#0A0B0D`, and the hand-off
 * must not flash from one canvas to another. What adapts per restaurant is
 * ATMOSPHERE — hue, glow, metal, depth — which is exactly what the tokens
 * already carry: a bright brand gets a bright room on a dark canvas, it does
 * not get a different colour scheme.
 *
 * MOTION
 * ------
 * The layer is choreographed like a hotel check-in rather than a loader:
 *
 *   COVER     the photograph settles in — opacity, a defocus pull (blur ->
 *             zero) and a whisper of scale-down, then a single specular light
 *             sweep and a slow Ken-Burns drift. Depth is real: the cover, the
 *             glints and the content column each travel at their own rate as
 *             the guest drags, all read from `--entry-progress`.
 *   IDENTITY  the seal springs into place (overshoot, then a slow floating
 *             breath), the brand light blooms behind it, and the Arabic type
 *             writes itself on from the reading edge — a right-to-left mask
 *             for Arabic, mirrored for Latin — with a per-line stagger.
 *   HAND-OFF  the sheet steps aside, the cover recedes a half-step and a
 *             brand-tinted veil dissolves over the seam, so the menu arrives
 *             through a curtain instead of appearing by deletion.
 *
 * Everything is CSS (opacity / transform / filter only) — no motion library, no
 * canvas, no requestAnimationFrame. Glints are a fixed, deterministic table and
 * are dropped on short viewports and under `prefers-reduced-motion`, because a
 * guest on a 5-year-old Android phone arriving through a QR code must never
 * wait on decoration.
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
 * The glint glyph: a four-point sparkle drawn as one path (no filter, no
 * gradient, no canvas) so a dozen of them cost less than a single shadow.
 */
const GLINT_PATH =
  'M12 1.6 C12.95 7.35 16.65 11.05 22.4 12 C16.65 12.95 12.95 16.65 12 22.4 C11.05 16.65 7.35 12.95 1.6 12 C7.35 11.05 11.05 7.35 12 1.6 Z';

/**
 * Deterministic ambient motes. A fixed table (no Math.random) keeps server
 * rendering, snapshot tests and the guest's first paint byte-identical, and it
 * keeps the field small enough to read as atmosphere rather than as an effect.
 *
 * `depth` is the parallax factor: 0 sits on the photograph, 1 sits with the
 * content. `spark` swaps a dot for a drawn glint, so the field reads as
 * light catching glass rather than as dust.
 */
const MOTES: ReadonlyArray<{
  left: number;
  top: number;
  size: number;
  delay: number;
  duration: number;
  driftX: number;
  depth: number;
  spark?: boolean;
}> = [
  { left: 12, top: 18, size: 3, delay: 0, duration: 17, driftX: 14, depth: 0.35 },
  { left: 26, top: 62, size: 8, delay: 2.4, duration: 21, driftX: -10, depth: 0.7, spark: true },
  { left: 44, top: 12, size: 4, delay: 1.2, duration: 19, driftX: 9, depth: 0.2 },
  { left: 58, top: 74, size: 2, delay: 3.1, duration: 24, driftX: -16, depth: 0.9 },
  { left: 71, top: 28, size: 11, delay: 0.6, duration: 16, driftX: 12, depth: 0.45, spark: true },
  { left: 84, top: 58, size: 2, delay: 4.2, duration: 22, driftX: -8, depth: 0.8 },
  { left: 33, top: 42, size: 9, delay: 5.5, duration: 26, driftX: 11, depth: 1, spark: true },
  { left: 66, top: 86, size: 3, delay: 2.9, duration: 18, driftX: -13, depth: 0.3 },
  { left: 8, top: 82, size: 2, delay: 6.1, duration: 23, driftX: 7, depth: 0.6 },
  { left: 92, top: 36, size: 2, delay: 1.8, duration: 20, driftX: -6, depth: 0.95 },
  { left: 51, top: 92, size: 12, delay: 7.4, duration: 25, driftX: 10, depth: 0.25, spark: true },
  { left: 20, top: 34, size: 2, delay: 8.2, duration: 28, driftX: -9, depth: 0.5 },
];

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Venue framing for the fact strip.
 *
 * `businessType` is tenant data, and these are the platform's own names for a
 * capability the venue genuinely has — the one piece of copy this layer adds.
 * Nothing here is a per-restaurant slogan, and nothing is invented when the
 * tenant has filled in nothing.
 */
const VENUE_FACTS: Record<string, { ar: string; en: string; Icon: LucideIcon }> = {
  RESTAURANT: { ar: 'خدمة الطاولة', en: 'Table service', Icon: UtensilsCrossed },
  CAFE: { ar: 'طلب سريع', en: 'Quick order', Icon: Coffee },
  BAKERY: { ar: 'استلام سريع', en: 'Quick pickup', Icon: Croissant },
};

/**
 * Script test guarding the Latin lockup under the name.
 *
 * Letter-spacing is a Latin-script device — it visibly breaks the connected
 * strokes of Arabic — so the tracked line is only ever rendered for a name
 * that carries no Arabic glyphs (the `nameEn` of an Arabic venue). A Latin or
 * mixed name falls back to the untracked identity, never to broken Arabic.
 */
const ARABIC_GLYPHS = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const hasArabicGlyphs = (text: string): boolean => ARABIC_GLYPHS.test(text);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Arabic counts inflect, so a bare number in front of a plural only reads as
 * Arabic from the count of 3 upwards — "1 أقسام" does not. Latin counts
 * distinguish one from many. Only the agreement is repaired here; the wording
 * stays the platform's own count copy.
 */
const arabicCount = (count: number, one: string, two: string, plural: string): string => {
  if (count === 1) return one;
  if (count === 2) return two;
  return `${count} ${plural}`;
};

export const RestaurantEntryExperience: React.FC<RestaurantEntryExperienceProps> = ({
  onEnter,
}) => {
  const { currentRestaurant, activeTableNumber, products, categories } = useRestaurant();

  // COMPETING THEME WRITER REMOVED (theme single-writer foundation).
  //
  // This overlay used to call useBrandTheme(..., { surfaceMode: 'dark' }),
  // writing the tenant palette onto <html> a second time. Because it forced
  // the DARK surface, mounting the entry overlay replaced the mode-aware
  // tokens of a light-mode menu with dark-adapted ones — and the old comment
  // here relied on React effect ordering ("parent effects run after children")
  // to undo it, which is exactly the kind of order-dependent correctness the
  // single-writer rule removes.
  //
  // This component renders INSIDE CustomerThemeProvider's scope and simply
  // inherits its tokens. Its own fixed dark-canvas gradient is unchanged; the
  // deliberate dark surface for the entry stage is expressed in the scope, not
  // by a second writer.

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

  // The Latin form of the name, shown as a tracked lockup under the display
  // name — but only when it is a genuinely different, Latin-script string.
  const latinName = (currentRestaurant?.nameEn || '').trim();
  const showLatinName = Boolean(latinName) && latinName !== displayName.trim() && !hasArabicGlyphs(latinName);

  /**
   * The fact strip: real tenant data only. A venue whose catalogue has not
   * loaded (or is empty) shows the single capability it definitely has instead
   * of placeholder cells, so the composition degrades instead of lying.
   */
  const facts = useMemo(() => {
    const venue = VENUE_FACTS[currentRestaurant?.businessType ?? 'RESTAURANT'] ?? VENUE_FACTS.RESTAURANT;
    const list: Array<{ id: string; Icon: LucideIcon; label: string }> = [
      { id: 'venue', Icon: venue.Icon, label: isEnglish ? venue.en : venue.ar },
    ];
    const dishCount = products?.length ?? 0;
    const categoryCount = categories?.length ?? 0;
    if (dishCount > 0) {
      list.push({
        id: 'dishes',
        Icon: ChefHat,
        label: isEnglish
          ? `${dishCount} ${dishCount === 1 ? 'dish' : 'dishes'}`
          : arabicCount(dishCount, 'صنف واحد في القائمة', 'صنفان في القائمة', 'صنف في القائمة'),
      });
    }
    if (categoryCount > 0) {
      list.push({
        id: 'sections',
        Icon: LayoutGrid,
        label: isEnglish
          ? `${categoryCount} ${categoryCount === 1 ? 'section' : 'sections'}`
          : arabicCount(categoryCount, 'قسم واحد', 'قسمان', 'أقسام'),
      });
    }
    return list;
  }, [currentRestaurant?.businessType, isEnglish, products, categories]);

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
          {/* Depth layer. The photograph never animates layout: it settles in
              on the reveal, then recedes a half-step as the guest drags, so
              the cover reads as a place with distance instead of a banner. */}
          <div className="entry-cover__depth">
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
          </div>

          <div className="entry-cover__scrim" aria-hidden="true" />
          <div className="entry-cover__vignette" aria-hidden="true" />
          {/* A single specular bloom on first paint — the room "opens" once
              and is calm from then on. Never a second animation layer. */}
          {!reducedMotion && <div className="entry-cover__flash" aria-hidden="true" />}
          {!reducedMotion && <div className="entry-cover__sweep" aria-hidden="true" />}

          {/* Atmosphere: a handful of slow motes, never a particle system. The
              outer span owns parallax, the glyph owns drift + twinkle, so the
              two motions can never overwrite each other's transform. */}
          {!reducedMotion && (
            <div className="entry-motes" aria-hidden="true">
              {MOTES.map((mote, index) => (
                <span
                  key={index}
                  className={`entry-mote${mote.spark ? ' entry-mote--spark' : ''}`}
                  style={{
                    left: `${mote.left}%`,
                    top: `${mote.top}%`,
                    width: `${mote.size}px`,
                    height: `${mote.size}px`,
                    ['--entry-mote-depth' as string]: String(mote.depth),
                  }}
                >
                  {mote.spark ? (
                    <svg
                      className="entry-mote__glyph"
                      viewBox="0 0 24 24"
                      focusable="false"
                      style={{
                        animationDelay: `${mote.delay}s`,
                        animationDuration: `${mote.duration / 2}s`,
                      }}
                    >
                      <path className="entry-mote__spark-path" d={GLINT_PATH} />
                    </svg>
                  ) : (
                    <span
                      className="entry-mote__dot"
                      style={{
                        animationDelay: `${mote.delay}s`,
                        animationDuration: `${mote.duration}s`,
                        ['--entry-mote-drift' as string]: `${mote.driftX}px`,
                      }}
                    />
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* --------------------------------------------------------------- */}
        {/* Ornamental frame — the composed "window" of the reference,      */}
        {/* translated into structure: a double hairline inset with         */}
        {/* bracketed corners, drawn only from the tenant's own line       */}
        {/* tokens. It carries NO motif, shape or colour of its own, so a   */}
        {/* grill, a café and a bakery are all framed in their own light,   */}
        {/* and whatever photograph the venue uploaded reads as a view      */}
        {/* through the frame instead of as a flat background.              */}
        {/* --------------------------------------------------------------- */}
        <div className="entry-frame" aria-hidden="true" />

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
            <span className="entry-composition__warmth" />
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

            {/* The name is wrapped so it can be revealed by a directional
                mask on the child while the h1 itself keeps the generic
                per-line rise — two owners, two properties, no fight. */}
            <h1 className="entry-identity__name">
              <span className="entry-name__type">{displayName}</span>
            </h1>

            {/* Latin lockup — the tracked second line of the reference's
                wordmark, kept strictly Latin: `showLatinName` already
                refuses anything with Arabic glyphs, so the tracking can
                never land on connected script. */}
            {showLatinName && <p className="entry-name__latin">{latinName}</p>}

            {/* Ornament as structure: one hairline rule through a diamond
                node. Both are tenant tokens, so the divider is the venue's
                own metal, never a fixed metallic. */}
            <span className="entry-rule" aria-hidden="true">
              <span className="entry-rule__node" />
            </span>

            {/* Omitted entirely when the tenant has no description. */}
            {description && <p className="entry-identity__desc">{description}</p>}
          </div>

          {/* Fact strip — the reference's column row of quiet claims, filled
              with the venue's own numbers instead of with slogans. */}
          <ul className="entry-facts" role="list">
            {facts.map((fact) => (
              <li key={fact.id} className="entry-fact">
                <fact.Icon className="entry-fact__icon" strokeWidth={1.35} aria-hidden="true" />
                <span className="entry-fact__label">{fact.label}</span>
              </li>
            ))}
          </ul>

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
{/* Specular white sheen over the artwork below — decorative, not
                          restaurant theming, and SVG gradient stops cannot
                          reliably take a CSS custom property here. */}
                      <stop offset="0%" stopColor="rgb(255 255 255 / 0.92)" /> {/* THEME-EXEMPT (illustration): white sheen */}
                      <stop offset="45%" stopColor="var(--m-brand-on-surface)" />
                      <stop offset="100%" stopColor="var(--m-brand-accent-on-surface)" />
                    </linearGradient>
                    <linearGradient id="entry-arrow-sheen" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="rgb(255 255 255 / 0.85)" /> {/* THEME-EXEMPT (illustration): white sheen */}
                      <stop offset="55%" stopColor="rgb(255 255 255 / 0.08)" /> {/* THEME-EXEMPT (illustration): white sheen */}
                      <stop offset="100%" stopColor="rgb(255 255 255 / 0)" /> {/* THEME-EXEMPT (illustration): white sheen */}
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
            {/* The reference teaches the gesture twice — an arrow that
                travels and a finger that drags. Both read from the same
                `--entry-dir`, so neither can ever point the wrong way. */}
            {!reducedMotion && (
              <Hand className="entry-arrow__hand" strokeWidth={1.4} aria-hidden="true" />
            )}
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

      {/* The hand-off curtain. It is inert for the whole stay of the layer and
          only breathes during the exit (`.entry-root[data-exiting='true']`),
          so the menu arrives through a dissolve rather than by deletion. */}
      <div className="entry-veil" aria-hidden="true" />
    </div>
  );
};

export default RestaurantEntryExperience;
