import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, RotateCcw, X } from 'lucide-react';
import { extractAlpha, formatColorOutput, hslToRgb, parseColor, rgbaCss, rgbToHex, rgbToHsl, type Hsl, type Rgb } from '../../theme/brandTheme';

/**
 * ThemeColorField — the color editing control of the theme editor.
 *
 * Design goal (PART 2): a modern, professional picker that a non-technical
 * restaurant owner can use, without adding a dependency. Collapsed it is a
 * single calm row — swatch + HEX — and the advanced controls (saturation /
 * lightness area, hue slider, RGB, copy, reset) open in a popover on demand.
 *
 * It is a CONTROLLED component: every drag/change calls `onChange(hex)` on the
 * caller's local edit state only — the caller decides when (and whether) to
 * persist, so live preview never spams the API.
 */

interface ThemeColorFieldProps {
  label: string;
  value: string | undefined;
  onChange: (hex: string) => void;
  /** Restore the field to its default value (shown as the reset target). */
  defaultValue?: string;
  /** Optional one-line hint under the label. */
  hint?: string;
  /** Compact variant for dense grids (no hint, smaller paddings). */
  compact?: boolean;
  /**
   * Overlay-special: the stored value may carry an alpha channel
   * (`rgba()`/`#RRGGBBAA`). When on, the field reads and preserves that
   * alpha (slider in the popover) and emits `rgba(r, g, b, a)` while
   * alpha < 1 — plain fields keep the HEX6-only contract.
   */
  allowAlpha?: boolean;
}

const HUE_RANGE_BACKGROUND =
  'linear-gradient(to left, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Parse any supported color into canonical uppercase HEX, else null. */
function toHexOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = parseColor(value);
  return parsed ? rgbToHex(parsed) : null;
}

export const ThemeColorField: React.FC<ThemeColorFieldProps> = ({
  label,
  value,
  onChange,
  defaultValue,
  hint,
  compact = false,
  allowAlpha = false,
}) => {
  const resolved = toHexOrNull(value) || toHexOrNull(defaultValue) || '#000000';
  const hsl = useMemo<Hsl>(() => rgbToHsl(parseColor(resolved) as Rgb), [resolved]);
  const alphaEnabled = allowAlpha === true;

  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(resolved);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);

  // Alpha of the RAW stored value (rgba()/hex8). Only tracked when enabled;
  // opaque stored colors resolve to 1 and keep emitting HEX6.
  const [alpha, setAlpha] = useState(() => (alphaEnabled ? extractAlpha(value) ?? 1 : 1));
  // Keep the alpha in sync with EXTERNAL value changes (preset clicks, theme
  // load) — same render-phase pattern as the hex draft above.
  const [lastAlphaSource, setLastAlphaSource] = useState(value);
  if (alphaEnabled && lastAlphaSource !== value) {
    setLastAlphaSource(value);
    setAlpha(extractAlpha(value) ?? 1);
  }

  // Keep the text draft in sync with EXTERNAL value changes (preset clicks)
  // by adjusting state during render — the React-recommended pattern here;
  // an effect would cascade an extra render on every keystroke round-trip.
  const [lastExternal, setLastExternal] = useState(resolved);
  if (lastExternal !== resolved) {
    setLastExternal(resolved);
    setHexDraft(resolved);
  }

  // Dismiss on outside pointer / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const emit = useCallback(
    (next: Hsl) => {
      const rgb = hslToRgb({ h: ((next.h % 360) + 360) % 360, s: clamp01(next.s), l: clamp01(next.l) });
      // Alpha-enabled fields carry the stored/chosen translucency through;
      // plain fields emit the exact legacy HEX6.
      onChange(alphaEnabled ? formatColorOutput(rgb, alpha) : rgbToHex(rgb));
    },
    [onChange, alphaEnabled, alpha]
  );

  const emitAlpha = useCallback(
    (nextAlpha: number) => {
      setAlpha(nextAlpha);
      onChange(formatColorOutput(hslToRgb(hsl), nextAlpha));
    },
    [onChange, hsl]
  );

  const commitHex = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      const parsed = toHexOrNull(trimmed);
      if (!parsed) {
        setHexDraft(resolved); // invalid input snaps back to the current color
        return;
      }
      if (alphaEnabled) {
        // A typed value with its own alpha channel (rgba(...)/#RRGGBBAA)
        // commits verbatim-in-color with that alpha; a plain opaque input
        // commits as HEX6 and returns the field to fully opaque.
        const typedAlpha = extractAlpha(trimmed);
        const typedRgb = parseColor(trimmed) as Rgb;
        setAlpha(typedAlpha ?? 1);
        onChange(formatColorOutput(typedRgb, typedAlpha ?? 1));
        return;
      }
      onChange(parsed);
    },
    [onChange, resolved, alphaEnabled]
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resolved);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the hex field right below is selectable */
    }
  }, [resolved]);

  // SV-area dragging (pointer capture keeps the drag alive outside the box).
  const handleSvPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const area = svRef.current;
      if (!area) return;
      const applyFromPoint = (clientX: number, clientY: number) => {
        const rect = area.getBoundingClientRect();
        const s = clamp01((clientX - rect.left) / Math.max(1, rect.width));
        const l = clamp01(1 - (clientY - rect.top) / Math.max(1, rect.height));
        emit({ h: hsl.h, s, l });
      };
      if (event.type === 'pointerdown') {
        area.setPointerCapture(event.pointerId);
        applyFromPoint(event.clientX, event.clientY);
      } else if (event.type === 'pointermove' && area.hasPointerCapture(event.pointerId)) {
        applyFromPoint(event.clientX, event.clientY);
      }
    },
    [emit, hsl.h]
  );

  const resetTarget = toHexOrNull(defaultValue);

  // Alpha-aware paint: while an alpha is active the swatch/cursor must show
  // the TRANSLUCENT result, not the opaque resolved hex underneath it.
  const displayColor = alphaEnabled && alpha < 1 ? rgbaCss(parseColor(resolved) as Rgb, alpha) : resolved;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] text-luxury-300 font-bold">{label}</span>
        {resetTarget && resetTarget !== resolved && (
          <button
            type="button"
            onClick={() => onChange(resetTarget)}
            className="p-1 rounded-md text-luxury-500 hover:text-luxury-200 hover:bg-luxury-800 transition-colors"
            title={`إعادة التعيين إلى ${resetTarget}`}
            aria-label={`إعادة تعيين لون ${label}`}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Swatch — opens the picker */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`relative shrink-0 rounded-lg border border-luxury-700 overflow-hidden transition-shadow cursor-pointer ${open ? 'ring-2 ring-gold-500/60' : ''}`}
          style={{ background: displayColor }}
          title={`${label} — ${resolved}`}
          aria-label={`${label}: فتح منتقي الألوان`}
          aria-expanded={open}
        >
          <span className={compact ? 'block w-8 h-8' : 'block w-9 h-9'} />
        </button>

        {/* HEX input */}
        <input
          type="text"
          dir="ltr"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitHex((e.target as HTMLInputElement).value);
            }
          }}
          spellCheck={false}
          maxLength={alphaEnabled ? 40 : 7}
          className="flex-1 min-w-0 bg-luxury-950 border border-luxury-800 rounded-lg px-2 py-1.5 font-mono text-[11px] text-luxury-100 text-left focus:border-gold-500/60"
          placeholder="#AABBCC"
          aria-label={`قيمة اللون ${label} بصيغة HEX`}
        />
      </div>

      {hint && !compact && <p className="text-[10px] text-luxury-500 mt-1 leading-relaxed">{hint}</p>}

      {open && (
        <div
          role="dialog"
          aria-label={`منتقي لون ${label}`}
          className="absolute z-50 top-full w-[248px] p-3 rounded-2xl bg-luxury-900 border border-luxury-700 shadow-2xl space-y-3"
          style={{ insetInlineStart: 0 }}
          dir="ltr"
        >
          {/* Saturation / Lightness area */}
          <div
            ref={svRef}
            onPointerDown={handleSvPointer}
            onPointerMove={handleSvPointer}
            className="relative h-36 rounded-xl cursor-crosshair touch-none select-none"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${Math.round(hsl.h)} 100% 50%))`,
            }}
          >
            <span
              className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                left: `${hsl.s * 100}%`,
                top: `${(1 - hsl.l) * 100}%`,
                background: displayColor,
              }}
            />
          </div>

          {/* Hue slider */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={Math.round(hsl.h)}
              onChange={(e) => emit({ ...hsl, h: Number(e.target.value) })}
              className="flex-1 h-2.5 appearance-none rounded-full cursor-pointer accent-gold-500"
              style={{ background: HUE_RANGE_BACKGROUND }}
              aria-label="درجة اللون (Hue)"
            />
            <span className="w-9 text-center font-mono text-[10px] text-luxury-400">{Math.round(hsl.h)}°</span>
          </div>

          {/* Alpha — only for fields whose stored value carries translucency (overlay). */}
          {alphaEnabled && (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(alpha * 100)}
                onChange={(e) => emitAlpha(Number(e.target.value) / 100)}
                className="flex-1 h-2.5 appearance-none rounded-full cursor-pointer accent-gold-500"
                style={{ background: `linear-gradient(to right, transparent, ${resolved})` }}
                aria-label="شفافية اللون (Alpha)"
              />
              <span className="w-9 text-center font-mono text-[10px] text-luxury-400">{Math.round(alpha * 100)}%</span>
            </div>
          )}

          {/* HEX + copy */}
          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-lg border border-luxury-700 shrink-0"
              style={{ background: displayColor }}
              aria-hidden="true"
            />
            <input
              type="text"
              dir="ltr"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitHex((e.target as HTMLInputElement).value);
                }
              }}
              spellCheck={false}
              maxLength={alphaEnabled ? 40 : 7}
              className="flex-1 min-w-0 bg-luxury-950 border border-luxury-800 rounded-lg px-2 py-1.5 font-mono text-xs text-luxury-100 text-left focus:border-gold-500/60"
              aria-label="قيمة HEX"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="p-2 rounded-lg bg-luxury-800 hover:bg-luxury-750 text-luxury-300 hover:text-luxury-100 transition-colors"
              title="نسخ اللون"
              aria-label="نسخ قيمة اللون"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-2 rounded-lg bg-luxury-800 hover:bg-luxury-750 text-luxury-400 hover:text-luxury-100 transition-colors"
              title="إغلاق"
              aria-label="إغلاق المنتقي"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-luxury-800">
            <span className="font-mono text-[10px] text-luxury-500">
              RGB {(() => {
                const rgb = parseColor(resolved);
                return rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '—';
              })()}
            </span>
            {resetTarget && (
              <button
                type="button"
                onClick={() => onChange(resetTarget)}
                className="flex items-center gap-1 text-[10px] text-luxury-400 hover:text-luxury-100 transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> إعادة تعيين
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
