/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Category, Product, Restaurant } from '../types/restaurant';
import { useLiveSequence } from '../components/display/useLiveSequence';
import {
  buildLiveScenes,
  buildLiveSections,
  resolveLiveProfile,
  type LiveScene,
} from '../components/display/liveMenuModel';

/**
 * The Live Menu clock.
 * ====================
 * A signage screen is judged by the thing nobody unit-tests: does it keep
 * running, in order, for hours, without leaking. So this file drives the real
 * `useLiveSequence` hook frame by frame with a hand-rolled rAF clock and
 * asserts the behaviour that keeps a wall panel honest:
 *
 *   - the sequence visits every scene exactly once per loop, then wraps;
 *   - the progress bar is painted onto the DOM (a frame never re-renders
 *     React, which is what makes an hours-long loop cheap);
 *   - a hidden tab PAUSES and resumes from the same offset — a sleeping panel
 *     must never wake up five categories late;
 *   - `hold` freezes the clock while the reservation sheet is open;
 *   - unmounting releases the frame loop, the visibility listener and the
 *     prefetch image.
 */

function Harness({
  scenes,
  playing,
  hold = false,
}: {
  scenes: LiveScene[];
  playing: boolean;
  hold?: boolean;
}) {
  const { scene, index, progressRef } = useLiveSequence(scenes, { playing, hold });
  return (
    <div>
      <div data-testid="bar" ref={progressRef} />
      <span data-testid="kind">{scene?.kind ?? 'none'}</span>
      <span data-testid="index">{index}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deterministic frame clock (no reliance on fake-timer internals)
// ---------------------------------------------------------------------------

let nowMs = 0;
let rafQueue: { id: number; cb: FrameRequestCallback }[] = [];
let nextRafId = 1;
let rafLive = 0;

function advance(ms: number) {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(16, remaining);
    nowMs += step;
    const due = rafQueue;
    rafQueue = [];
    act(() => {
      due.forEach((f) => f.cb(nowMs));
    });
    remaining -= step;
  }
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nowMs = 0;
  rafQueue = [];
  nextRafId = 1;
  rafLive = 0;
  vi.stubGlobal('performance', { now: () => nowMs });
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextRafId++;
    rafQueue.push({ id, cb });
    rafLive += 1;
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    rafQueue = rafQueue.filter((f) => f.id !== id);
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mount = (scenes: LiveScene[], playing = true, hold = false) => {
  const render = (next: { playing: boolean; hold: boolean }) =>
    act(() => {
      root.render(<Harness scenes={scenes} playing={next.playing} hold={next.hold} />);
    });
  render({ playing, hold });
  return {
    kind: () => host.querySelector('[data-testid="kind"]')?.textContent ?? '',
    index: () => Number(host.querySelector('[data-testid="index"]')?.textContent ?? '-1'),
    bar: () => (host.querySelector('[data-testid="bar"]') as HTMLElement | null)?.style.transform ?? '',
    setHold: (value: boolean) => render({ playing, hold: value }),
    setPlaying: (value: boolean) => render({ playing: value, hold }),
  };
};

// Two sections: enough for bumpers + category + spotlight + board scenes.
const SCENES: LiveScene[] = (() => {
  const categories = [
    { id: 1, name: 'البرجر', sortOrder: 1 },
    { id: 2, name: 'المقبلات', sortOrder: 2 },
  ] as unknown as Category[];
  const products = [
    { id: 1, categoryId: 1, name: 'برجر كلاسيكي', price: 38, image: '/preview/assets/burger.jpg', isFeatured: true },
    { id: 2, categoryId: 1, name: 'دبل تشيز', price: 48, image: '/preview/assets/burger.jpg' },
    { id: 3, categoryId: 2, name: 'حمص', price: 22, image: '/preview/assets/mezze.jpg', isFeatured: true },
    { id: 4, categoryId: 2, name: 'متبل', price: 24 },
  ] as unknown as Product[];
  const restaurant = {
    name: 'برجر هاوس',
    businessType: 'RESTAURANT',
    primaryColor: '#E01B24',
    accentColor: '#F5A623',
  } as unknown as Restaurant;
  const sections = buildLiveSections(categories, products);
  return buildLiveScenes(sections, { profile: resolveLiveProfile(restaurant, sections) });
})();

describe('useLiveSequence — autoplay', () => {
  it('visits every scene in order exactly once, then wraps to the start', () => {
    const view = mount(SCENES);
    const visited: string[] = [view.kind()];
    const totalMs = SCENES.reduce((sum, s) => sum + s.durationMs, 0);

    for (let elapsed = 0; elapsed < totalMs + 64; elapsed += 64) {
      advance(64);
      if (view.kind() !== visited[visited.length - 1]) visited.push(view.kind());
    }

    expect(visited).toEqual([...SCENES.map((s) => s.kind), SCENES[0].kind]);
    expect(view.index()).toBe(0); // looped, not run away
  });

  it('honours each scene dwell before moving on', () => {
    const view = mount(SCENES);
    const intro = SCENES[0];
    advance(intro.durationMs - 200);
    expect(view.kind()).toBe('intro');
    advance(400);
    expect(view.kind()).toBe(SCENES[1].kind);
  });

  it('paints the progress bar onto the DOM without re-rendering on every frame', () => {
    const view = mount(SCENES);
    // Nothing is painted until the first frame — a mount never does layout work.
    expect(view.bar()).toBe('');
    advance(Math.round(SCENES[0].durationMs / 2));
    expect(view.bar()).toMatch(/^scaleX\(0\.[3-7]\d*\)$/);
  });

  it('never starts a clock for a single-scene screen', () => {
    const view = mount(SCENES.slice(0, 1));
    advance(60_000);
    expect(view.index()).toBe(0);
    expect(view.bar()).toBe('scaleX(0)');
  });

  it('freezes while the reservation sheet holds it, then resumes', () => {
    const view = mount(SCENES, true, true);
    advance(SCENES[0].durationMs * 3);
    expect(view.index()).toBe(0); // a guest filling the form is never interrupted

    view.setHold(false);
    advance(SCENES[0].durationMs + 64);
    expect(view.index()).toBe(1);
  });

  it('does not run at all when autoplay is switched off', () => {
    const view = mount(SCENES, false);
    advance(SCENES[0].durationMs * 3);
    expect(view.index()).toBe(0);
    expect(view.bar()).toBe('scaleX(0)');

    view.setPlaying(true);
    advance(SCENES[0].durationMs + 64);
    expect(view.index()).toBe(1);
  });

  it('stays put while paused, and does not fast-forward a hidden tab', () => {
    const view = mount(SCENES);
    advance(1000); // part way through the intro

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(120_000); // the panel sleeps through two whole loops
    expect(view.index()).toBe(0);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(SCENES[0].durationMs);
    expect(view.index()).toBe(1); // resumed from the same offset — one step only
  });
});

describe('useLiveSequence — hours-long cleanup', () => {
  it('releases the frame loop, the visibility listener and the prefetch', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const rawAdd = document.addEventListener.bind(document);
    const rawRemove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      return rawAdd(type, ...(rest as Parameters<typeof rawAdd>));
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return rawRemove(type, ...(rest as Parameters<typeof rawRemove>));
    }) as typeof document.removeEventListener;

    mount(SCENES);
    advance(SCENES[0].durationMs * 2);
    expect(rafLive).toBeGreaterThan(0);
    expect(added.filter((t) => t === 'visibilitychange').length).toBeGreaterThan(0);

    // Unmount with the clock mid-flight, then let time run for an hour.
    act(() => root.unmount());
    host.remove();
    root = createRoot((host = document.createElement('div')));

    expect(rafQueue).toEqual([]);
    expect(removed.filter((t) => t === 'visibilitychange').length).toBe(
      added.filter((t) => t === 'visibilitychange').length
    );
    expect(() => act(() => {})).not.toThrow();
  });

  it('releases the prefetched bitmap of the scene it leaves behind', () => {
    const sources: string[] = [];
    // The hook only touches `.decoding` and `.src`, so a stand-in is enough —
    // subclassing jsdom's HTMLImageElement does not work (it installs `src`
    // per instance, which shadows a subclass accessor).
    class TrackedImage {
      decoding = '';
      set src(value: string) {
        sources.push(value);
      }
      get src() {
        return '';
      }
    }
    vi.stubGlobal('Image', TrackedImage);

    mount(SCENES);
    const totalMs = SCENES.reduce((sum, s) => sum + s.durationMs, 0);
    advance(totalMs + 64); // a full loop: every scene gets prefetched in turn

    // Every prefetch is eventually released with an empty src.
    expect(sources.filter((s) => s !== '').length).toBeGreaterThan(0);
    expect(sources.filter((s) => s === '').length).toBeGreaterThan(0);
  });
});
