import React, { useEffect, useMemo, useRef } from 'react';

/**
 * PlexusField — a luxury "networking" ambience: slow-drifting points of light
 * linked by hairlines that fade with distance, in the tenant's own colour.
 *
 * Design contract (matches the entry layer's conventions):
 *   - PRESENTATION ONLY. No data, no events, no logic beyond drawing.
 *   - DETERMINISTIC: a seeded PRNG (mulberry32) places every point, so the
 *     first paint is byte-identical across renders and tenants — there is no
 *     unseeded randomness anywhere in the tree.
 *   - TENANT-COLOURED: the glow reads the tenant's `--brand-primary-strong`
 *     custom property once at mount; a `color` prop can override it.
 *   - MINDFUL: honours prefers-reduced-motion (one static frame, no rAF loop),
 *     pauses when the tab is hidden, scales for devicePixelRatio, and tears
 *     down every observer/loop on unmount.
 *   - No dependency: one <canvas>, ~30 points, a single rAF loop.
 */

interface PlexusFieldProps {
  /** Number of drifting points (density). */
  count?: number;
  /** Max link distance as a fraction of the field's shorter side. */
  linkRatio?: number;
  /** Drift speed in px/second (before the 0..1 easing). */
  speed?: number;
  /** Master opacity of the whole field (points + lines). */
  opacity?: number;
  /** Override the tenant colour (default: --brand-primary-strong). */
  color?: string;
  /** Deterministic seed — same seed, same constellation. */
  seed?: number;
  className?: string;
}

/** mulberry32 — tiny, fast, deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHexToRgb(color: string): [number, number, number] | null {
  const value = (color || '').trim();
  if (!value.startsWith('#')) return null;
  let hex = value.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

interface Point {
  x: number; // 0..1 field space
  y: number;
  vx: number; // field-space units per second
  vy: number;
  r: number; // radius px
  phase: number; // 0..2π pulse offset
}

export const PlexusField: React.FC<PlexusFieldProps> = ({
  count = 24,
  linkRatio = 0.22,
  speed = 7,
  opacity = 0.55,
  color,
  seed = 7,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The constellation is fixed by the seed — created once per mount.
  const points = useMemo<Point[]>(() => {
    const rand = mulberry32(seed * 1013904223 + 12345);
    return Array.from({ length: count }, () => ({
      x: rand(),
      y: rand(),
      vx: (rand() - 0.5) * 2,
      vy: (rand() - 0.5) * 2,
      r: 1.1 + rand() * 1.7,
      phase: rand() * Math.PI * 2,
    }));
  }, [count, seed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Tenant colour: the prop wins, otherwise the brand token on <html>.
    const token =
      color ||
      getComputedStyle(document.documentElement).getPropertyValue('--brand-primary-strong') ||
      getComputedStyle(document.documentElement).getPropertyValue('--brand-primary') ||
      '';
    const rgb = parseHexToRgb(token.trim());
    const [r, g, b] = rgb ?? [212, 175, 55]; // fallback: the platform's gold
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let running = true;
    let last = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number, animate: boolean) => {
      const dt = animate ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const minSide = Math.min(width, height) || 1;
      const linkDist = minSide * linkRatio;

      ctx.clearRect(0, 0, width, height);

      // Drift (field space), wrapping at the edges.
      for (const p of points) {
        if (animate) {
          p.x += (p.vx * speed * dt) / minSide;
          p.y += (p.vy * speed * dt) / minSide;
          if (p.x < -0.02) p.x += 1.04;
          if (p.x > 1.02) p.x -= 1.04;
          if (p.y < -0.02) p.y += 1.04;
          if (p.y > 1.02) p.y -= 1.04;
        }
      }

      // Links — a hairline whose strength fades with distance.
      const t = animate ? now / 1000 : 0;
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i];
          const c = points[j];
          const dx = (a.x - c.x) * width;
          const dy = (a.y - c.y) * height;
          const d = Math.hypot(dx, dy);
          if (d > linkDist) continue;
          const strength = (1 - d / linkDist) * opacity * 0.32;
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strength.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x * width, a.y * height);
          ctx.lineTo(c.x * width, c.y * height);
          ctx.stroke();
        }
      }

      // Points — a soft halo + a bright core, gently breathing.
      for (const p of points) {
        const pulse = animate ? 0.62 + 0.38 * Math.sin(t * 0.9 + p.phase) : 0.8;
        const px = p.x * width;
        const py = p.y * height;
        const halo = p.r * 5.5 * pulse;
        const haloGrad = ctx.createRadialGradient(px, py, 0, px, py, halo);
        haloGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(0.22 * opacity * pulse).toFixed(3)})`);
        haloGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(px, py, halo, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.85 * opacity * pulse).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      draw(now, true);
      raf = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    resize();
    if (reduced) {
      // One composed static frame — the constellation stays, the motion leaves.
      draw(performance.now(), false);
    } else {
      raf = requestAnimationFrame(loop);
      document.addEventListener('visibilitychange', onVisibility);
    }

    const ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            resize();
            if (reduced) draw(performance.now(), false);
          })
        : null;
    if (ro) ro.observe(canvas);
    else window.addEventListener('resize', resize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, [points, linkRatio, speed, opacity, color, seed]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      role="presentation"
    />
  );
};

export default PlexusField;
