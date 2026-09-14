/** @vitest-environment jsdom */
/**
 * Menu page turn — runtime behaviour of `useMenuPageFlip`.
 *
 * The hook is the only moving part of the page flip: it watches which section
 * is on screen, works out whether the guest moved forward or backward, and
 * drives the CSS through two attributes. These tests pin the parts that are
 * easy to regress:
 *   • arrival is not a turn (the entry experience already animates that);
 *   • direction comes from the page ORDER, not from which chip was tapped;
 *   • the same direction twice in a row still replays (the restart trap);
 *   • a suspended turn (search) never replays afterwards;
 *   • reduced motion stops the motion, never the navigation.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMenuPageFlip } from '../hooks/useMenuPageFlip';

interface HarnessProps {
  pages: string[];
  activePageId: string;
  onTurn?: (id: string) => void;
  turnMs?: number;
  swipe?: boolean;
  enabled?: boolean;
}

const Harness: React.FC<HarnessProps> = ({
  pages,
  activePageId,
  onTurn,
  turnMs = 40,
  swipe = true,
  enabled = true,
}) => {
  const { attachPageNode, direction, pageIndex, pageCount, canTurnPrev, canTurnNext, turnBy } =
    useMenuPageFlip({ pages, activePageId, onTurn, turnMs, swipe, enabled });
  return (
    <div
      ref={attachPageNode}
      className="menu-page"
      data-flip={direction || 'none'}
      data-page={pageIndex}
      data-pages={pageCount}
      data-prev={String(canTurnPrev)}
      data-next={String(canTurnNext)}
    >
      <button type="button" data-forward onClick={() => turnBy(1)}>
        forward
      </button>
      <button type="button" data-back onClick={() => turnBy(-1)}>
        back
      </button>
    </div>
  );
};

let host: HTMLDivElement;
let root: Root;
let originalMatchMedia: unknown;

/**
 * This jsdom build ships no `matchMedia` at all, so the query is installed per
 * test and removed afterwards. (The hook itself treats a missing `matchMedia`
 * as "motion is fine", which is what a browser without the API would do.)
 */
function stubMatchMedia(matches: boolean) {
  const implementation = (query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, 'matchMedia', {
    value: implementation,
    writable: true,
    configurable: true,
  });
}

const page = () => host.querySelector('.menu-page') as HTMLDivElement;
const settle = async (ms = 220) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  originalMatchMedia = (window as unknown as { matchMedia?: unknown }).matchMedia;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  stubMatchMedia(false);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, 'matchMedia', {
    value: originalMatchMedia,
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
});

const PAGES = ['all', 'c1', 'c2'];

describe('page turn — the hook', () => {
  it('does not turn on arrival: the first page is an entrance, not a flip', () => {
    act(() => root.render(<Harness pages={PAGES} activePageId="all" />));

    expect(page().dataset.flip).toBe('none');
    expect(page().dataset.turning).toBe('false');
    expect(page().dataset.page).toBe('0');
    expect(page().dataset.pages).toBe('3');
  });

  it('turns forward when the guest moves to a later section', async () => {
    act(() => root.render(<Harness pages={PAGES} activePageId="all" />));
    act(() => root.render(<Harness pages={PAGES} activePageId="c1" />));

    expect(page().dataset.flip).toBe('next');
    expect(page().dataset.turning).toBe('true');

    await settle();
    expect(page().dataset.turning).toBe('false');
    expect(page().dataset.flip).toBe('none');
  });

  it('turns backward when the guest returns to an earlier section', () => {
    act(() => root.render(<Harness pages={PAGES} activePageId="c2" />));
    act(() => root.render(<Harness pages={PAGES} activePageId="c1" />));

    expect(page().dataset.flip).toBe('prev');
    expect(page().dataset.turning).toBe('true');
  });

  it('replays the same direction on a second turn (the restart trap)', async () => {
    act(() => root.render(<Harness pages={PAGES} activePageId="all" />));

    act(() => root.render(<Harness pages={PAGES} activePageId="c1" />));
    expect(page().dataset.turning).toBe('true');
    await settle();
    expect(page().dataset.turning).toBe('false');

    // Same direction again: a selector whose value never changes would simply
    // keep the finished animation, so the attribute is dropped and re-set.
    act(() => root.render(<Harness pages={PAGES} activePageId="c2" />));
    expect(page().dataset.flip).toBe('next');
    expect(page().dataset.turning).toBe('true');
  });

  it('asks for pages by id and never wraps around the booklet', () => {
    const onTurn = vi.fn();
    act(() => root.render(<Harness pages={PAGES} activePageId="c1" onTurn={onTurn} />));

    expect(page().dataset.prev).toBe('true');
    expect(page().dataset.next).toBe('true');

    act(() => (host.querySelector('[data-forward]') as HTMLButtonElement).click());
    expect(onTurn).toHaveBeenLastCalledWith('c2');

    act(() => (host.querySelector('[data-back]') as HTMLButtonElement).click());
    expect(onTurn).toHaveBeenLastCalledWith('all');

    // Last page: forward is a no-op rather than a jump to the first.
    act(() => root.render(<Harness pages={PAGES} activePageId="c2" onTurn={onTurn} />));
    onTurn.mockClear();
    expect(page().dataset.next).toBe('false');
    act(() => (host.querySelector('[data-forward]') as HTMLButtonElement).click());
    expect(onTurn).not.toHaveBeenCalled();
  });

  it('stays still while a search is active, then resyncs silently', () => {
    act(() => root.render(<Harness pages={PAGES} activePageId="c1" enabled={false} />));
    act(() => root.render(<Harness pages={PAGES} activePageId="all" enabled={false} />));

    expect(page().dataset.flip).toBe('none');
    expect(page().dataset.turning).toBe('false');
    // Re-enabling must not replay the turn that happened while it was off.
    act(() => root.render(<Harness pages={PAGES} activePageId="all" enabled />));
    expect(page().dataset.flip).toBe('none');
  });

  it('does not animate at all for reduced-motion guests, but still turns pages', () => {
    stubMatchMedia(true);
    const onTurn = vi.fn();
    act(() => root.render(<Harness pages={PAGES} activePageId="all" onTurn={onTurn} />));
    act(() => root.render(<Harness pages={PAGES} activePageId="c2" onTurn={onTurn} />));

    expect(page().dataset.flip).toBe('none');
    expect(page().dataset.turning).toBe('false');
    expect(page().dataset.page).toBe('2');

    act(() => (host.querySelector('[data-back]') as HTMLButtonElement).click());
    expect(onTurn).toHaveBeenLastCalledWith('c1');
  });

});

