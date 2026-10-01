/**
 * PRODUCT DETAIL MODAL — layout contract against the image take-over bug.
 * ===========================================================================
 *
 * THE BUG THIS PINS
 * -----------------
 * The dialog is a `max-h-[90vh]` flex column with three children:
 *
 *     header (dish photo, aspect 16:9) · body (customization) · footer (CTA)
 *
 * The header used to be `shrink-0` while the footer was `shrink-0` too. On
 * any viewport where the natural 16:9 header + footer exceed 90vh —
 * landscape phones, split-screen, short windows — the flex collapse had
 * exactly one participant left: the `flex-1` customization body, which
 * shrank to ZERO. Result: the photo appeared to take over the entire
 * dialog and the guest could no longer customize the order.
 *
 * THE CONTRACT
 * ------------
 * The header is the sole shock absorber (flex-shrink default, floored by a
 * min-height so the photo never disappears); the body is an explicit
 * shrinking scroll region (`flex-1 min-h-0 overflow-y-auto`); the footer
 * keeps its `shrink-0` so the CTA is always reachable. On normal-height
 * viewports the card never overflows its cap, so this renders exactly as
 * before.
 *
 * Checked as a source contract (the repo's established pattern for layout
 * guarantees that jsdom cannot compute) — every assertion names the exact
 * class that carries the behaviour.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  fileURLToPath(new URL('../components/customer/ProductDetailModal.tsx', import.meta.url)),
  'utf8'
);

/** The className string of the first element matching a marker comment. */
function classOf(selectorStart: string): string {
  const idx = src.indexOf(selectorStart);
  expect(idx, `marker "${selectorStart}" must exist`).toBeGreaterThan(-1);
  const window = src.slice(idx, idx + 1800);
  const match = window.match(/className="([^"]+)"/);
  expect(match, `className near "${selectorStart}"`).toBeTruthy();
  return match![1];
}

describe('dialog budget: 90vh cap on a flex column', () => {
  it('the dialog card keeps its 90vh cap, column layout and clipping', () => {
    const card = classOf('role="dialog"');
    expect(card).toContain('max-h-[90vh]');
    expect(card).toContain('flex flex-col');
    expect(card).toContain('overflow-hidden');
  });
});

describe('the photo header can shrink — it is NOT the take-over culprit any more', () => {
  const header = classOf('{/* Sticky Header with Close Button & Image');

  it('keeps the 16:9 photo framing', () => {
    expect(header).toContain('aspect-[16/9]');
  });

  it('is no longer shrink-proofed (the root cause of the collapse)', () => {
    expect(header.split(/\s+/)).not.toContain('shrink-0');
  });

  it('is floored so the dish photo always stays visible', () => {
    expect(header).toMatch(/min-h-\[/);
  });
});

describe('the customization panel keeps its share of the budget', () => {
  const body = classOf('{/* Scrollable Customization Content');

  it('is the flexible member and scrolls internally', () => {
    expect(body.split(/\s+/)).toContain('flex-1');
    expect(body.split(/\s+/)).toContain('overflow-y-auto');
  });

  it('opts out of the implicit flex minimum so it can shrink to a scroll area', () => {
    expect(body.split(/\s+/)).toContain('min-h-0');
  });
});

describe('the CTA footer stays reachable', () => {
  const footer = classOf('{/* Fixed Footer with Quantity & Add to Cart Button');

  it('keeps shrink-0 so quantity + add-to-cart never collapse', () => {
    expect(footer.split(/\s+/)).toContain('shrink-0');
  });
});
