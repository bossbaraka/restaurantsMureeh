// @vitest-environment jsdom
/**
 * Product card — click model (interaction contract).
 *
 * The card is a whole-card affordance (`.menu-card__hit`, an absolutely
 * positioned button covering the card) with the action controls stacked ON TOP
 * of it (`.menu-actions`, z-index 2). That split is only correct if every
 * control keeps its own click and nothing falls through:
 *
 *   click card / image / title / description / price → onSelect  (details)
 *   click «إضافة»        → onQuickAdd      ONLY
 *   click «تخصيص»        → onSelect        ONLY
 *   click stepper + / −  → onQuantityChange ONLY
 *
 * Rendered interactively (createRoot + act) so the real handlers are exercised.
 * NOTE: jsdom does NOT do hit-testing, so this file proves handler routing and
 * DOM structure; the badge/hit stacking itself is pinned as a CSS contract in
 * menuStyles.test.ts.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProductCard } from '../components/customer/ProductCard';
import type { Product } from '../types/restaurant';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProduct: Product = {
  id: 'p1',
  restaurantId: 'r1',
  categoryId: 'c1',
  name: 'منسف الديوان الملكي',
  nameEn: 'Diwan Mansaf',
  description: 'لحم ضأن مطهو ببطء مع لبن الجميد والأرز البسمتي.',
  price: 89,
  image: 'https://example.test/mansaf.jpg',
  isAvailable: true,
};

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
const onQuickAdd = vi.fn();
const onQuantityChange = vi.fn();

const click = async (el: Element | null | undefined) => {
  expect(el, 'element to click must exist').toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const render = async (
  product: Product,
  { cartQuantity = 0, featured = false }: { cartQuantity?: number; featured?: boolean } = {}
) => {
  await act(async () => {
    root.render(
      <ProductCard
        product={product}
        currency="₪"
        cartQuantity={cartQuantity}
        featured={featured}
        onSelect={onSelect}
        onQuickAdd={onQuickAdd}
        onQuantityChange={onQuantityChange}
      />
    );
  });
};

const withSizes: Product = {
  ...baseProduct,
  sizes: [
    { id: 's1', name: 'عادي', priceModifier: 0 },
    { id: 's2', name: 'كبير', priceModifier: 14 },
  ],
};

beforeEach(() => {
  onSelect.mockClear();
  onQuickAdd.mockClear();
  onQuantityChange.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('ProductCard — click model', () => {
  it('opens the details sheet from the whole-card hit area', async () => {
    await render(baseProduct);

    const hit = container.querySelector('.menu-card__hit');
    expect(hit).toBeTruthy();
    // Sibling of the action controls (not a wrapper) — the buttons are never
    // nested inside the hit area.
    expect(hit!.querySelector('button')).toBeNull();
    expect(container.querySelector('.menu-actions')!.contains(hit!)).toBe(false);

    await click(hit);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'p1' });
    expect(onQuickAdd).not.toHaveBeenCalled();
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it('«إضافة» only quick-adds — it never opens the details sheet', async () => {
    await render(baseProduct);

    const add = container.querySelector('.menu-add');
    expect(add).toBeTruthy();
    expect(add!.className).not.toContain('menu-add--customize');

    await click(add);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd.mock.calls[0][0]).toMatchObject({ id: 'p1' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it('«تخصيص» only opens the customization sheet — it never quick-adds', async () => {
    await render(withSizes);

    const customize = container.querySelector('.menu-add--customize');
    expect(customize).toBeTruthy();
    expect(customize!.textContent).toContain('تخصيص');

    await click(customize);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).not.toHaveBeenCalled();
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it('stepper − / + only change the quantity', async () => {
    await render(withSizes, { cartQuantity: 2 });

    const buttons = Array.from(container.querySelectorAll('.menu-qty button'));
    expect(buttons).toHaveLength(2);
    // No add/customize button while the dish is in the cart.
    expect(container.querySelector('.menu-add')).toBeNull();

    await click(buttons[1]); // +
    expect(onQuantityChange).toHaveBeenCalledTimes(1);
    expect(onQuantityChange.mock.calls[0][1]).toBe(3);

    await click(buttons[0]); // −
    expect(onQuantityChange).toHaveBeenCalledTimes(2);
    expect(onQuantityChange.mock.calls[1][1]).toBe(1);

    // The stepper must not leak into the card's own affordances.
    expect(onSelect).not.toHaveBeenCalled();
    expect(onQuickAdd).not.toHaveBeenCalled();
  });

  it('keeps exactly one primary action and one card-wide target in the DOM', async () => {
    await render(withSizes);

    // Buttons: [CTA (customize)] + [whole-card hit].
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.className)).toEqual([
      'menu-add menu-add--customize',
      'menu-card__hit',
    ]);
    // The hit is last in DOM order so the action controls stay first for
    // keyboard users — and both are reachable.
    expect(buttons[1].getAttribute('type')).toBe('button');
    expect(buttons[0].getAttribute('tabindex')).toBeNull();
    expect(buttons[1].getAttribute('tabindex')).toBe('0');
  });

  it('keeps the badge overlay non-interactive and above the scrim by DOM order', async () => {
    await render({ ...baseProduct, allergens: ['مكسرات'] }, { featured: true });

    const media = container.querySelector('.menu-media')!;
    const scrim = media.querySelector('.menu-media__scrim')!;
    const badges = media.querySelector('.menu-media__badges')!;
    const hit = container.querySelector('.menu-card__hit')!;

    // Why the badged overlay no longer needs a z-index: it is emitted AFTER the
    // scrim, so plain DOM order already paints it on top of the gradient…
    const order = Array.prototype.indexOf;
    expect(order.call(Array.from(media.children), badges)).toBeGreaterThan(
      order.call(Array.from(media.children), scrim)
    );
    // …while the card-wide hit stays the top-most click target, so a tap on a
    // badge activates «عرض تفاصيل …» like any other part of the card.
    expect(hit.contains(badges)).toBe(false);
    expect(badges.querySelector('a, button, input, [role="button"]')).toBeNull();
    expect(container.querySelector('.menu-badge--signature')!.textContent).toContain('طبق الشيف');
    expect(container.querySelector('.menu-badge--dark')!.textContent).toContain('حساسية');
  });

  it('never routes a click through a propagation hack', async () => {
    await render(withSizes);
    // No stopPropagation/preventDefault anywhere in the rendered markup: the
    // sibling structure + stacking is what keeps the clicks apart.
    expect(container.innerHTML).not.toContain('stopPropagation');

    await click(container.querySelector('.menu-add--customize'));
    await click(container.querySelector('.menu-card__hit'));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onQuickAdd).not.toHaveBeenCalled();
  });
});
