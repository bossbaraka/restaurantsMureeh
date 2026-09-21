// @vitest-environment jsdom
/**
 * Product form — ingredient lists must stay two independent decisions.
 *
 * The form used to hold ONE list (labelled «مكونات يمكن للعميل استبعادها»),
 * submit it under both keys and hydrate BOTH keys from either stored column:
 *
 *   payload:     ingredients = removableIngredients = the same array
 *   hydration:   removableIngredients || ingredients
 *   backend:     removableIngredients || ingredients (create + update)
 *
 * That collapse is what made every dish with a composition list look
 * customizable to the guest. This file locks the separation: descriptive
 * composition → `ingredients`, guest-removable list → `removableIngredients`,
 * hydrated separately, edited separately, submitted separately.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Category, Product } from '../types/restaurant';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const showToast = vi.fn();

vi.mock('../context/RestaurantContext', () => ({
  useRestaurant: () => ({
    categories: [],
    addProduct: vi.fn(async () => true),
    updateProduct: vi.fn(async () => true),
    currentRestaurant: { id: 'rest-1', currency: '₪' },
    showToast,
  }),
}));

const { ProductFormModal } = await import('../components/manager/ProductFormModal');

const categories: Category[] = [{ id: 'c1', restaurantId: 'rest-1', name: 'مشاوي', sortOrder: 1 }];

const baseProduct: Product = {
  id: 'p1',
  restaurantId: 'rest-1',
  categoryId: 'c1',
  name: 'منسف',
  nameEn: 'Mansaf',
  description: 'وصف',
  price: 89,
  image: 'https://example.test/mansaf.jpg',
  isAvailable: true,
};

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

const submit = async () => {
  const form = container.querySelector('form');
  expect(form, 'the form must be rendered').toBeTruthy();
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

const click = async (el: Element | null | undefined) => {
  expect(el, 'element to click must exist').toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el, 'input to type into must exist').toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** The <div> card that owns the given <label> heading. */
const sectionByLabel = (text: string): HTMLElement => {
  const label = Array.from(container.querySelectorAll('label')).find(
    (l) => (l.textContent || '').trim() === text
  );
  expect(label, `section «${text}» must exist`).toBeTruthy();
  return label!.parentElement as HTMLElement;
};

const DESCRIPTIVE = 'مكونات الطبق';
const REMOVABLE = 'مكونات يمكن للعميل استبعادها';

const render = async (product: Product | null) => {
  await act(async () => {
    root.render(
      <ProductFormModal
        product={product}
        isOpen
        onClose={onClose}
        categories={categories}
        onSave={onSave}
      />
    );
  });
};

beforeEach(() => {
  onSave = vi.fn(async () => true);
  onClose = vi.fn();
  showToast.mockClear();
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

describe('ProductFormModal — independent ingredient lists', () => {
  it('exposes both lists with their own headings', async () => {
    await render(baseProduct);
    expect(sectionByLabel(DESCRIPTIVE)).toBeTruthy();
    expect(sectionByLabel(REMOVABLE)).toBeTruthy();
  });

  it('hydrates each list from its own field only', async () => {
    await render({ ...baseProduct, ingredients: ['لحم'], removableIngredients: ['بصل'] });

    const descriptive = sectionByLabel(DESCRIPTIVE);
    const removable = sectionByLabel(REMOVABLE);

    expect(descriptive.textContent).toContain('لحم');
    expect(descriptive.textContent).not.toContain('بصل');
    expect(removable.textContent).toContain('بصل');
    expect(removable.textContent).not.toContain('لحم');
  });

  it('does not borrow descriptive ingredients for the removable list', async () => {
    await render({ ...baseProduct, ingredients: ['لحم'], removableIngredients: [] });

    expect(sectionByLabel(DESCRIPTIVE).textContent).toContain('لحم');
    // The removable list stays empty — no alias, no fallback.
    expect(sectionByLabel(REMOVABLE).textContent).not.toContain('لحم');
  });

  it('submits ingredients=[لحم] / removableIngredients=[] without collapsing them', async () => {
    await render({ ...baseProduct, ingredients: ['لحم'], removableIngredients: [] });
    await submit();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [payload] = onSave.mock.calls[0] as [Record<string, unknown>, string?];
    expect(payload.ingredients).toEqual(['لحم']);
    expect(payload.removableIngredients).toBeUndefined();
    expect(payload.removableIngredients ?? []).not.toContain('لحم');
  });

  it('submits ingredients=[لحم] / removableIngredients=[بصل] as two distinct keys', async () => {
    await render({ ...baseProduct, ingredients: ['لحم'], removableIngredients: ['بصل'] });
    await submit();

    const [payload] = onSave.mock.calls[0] as [Record<string, unknown>, string?];
    expect(payload.ingredients).toEqual(['لحم']);
    expect(payload.removableIngredients).toEqual(['بصل']);
  });

  it('adding to one list never writes into the other', async () => {
    await render({ ...baseProduct, ingredients: [], removableIngredients: [] });

    await type(
      sectionByLabel(DESCRIPTIVE).querySelector<HTMLInputElement>('input[aria-label="اسم مكون الطبق"]'),
      'لوز'
    );
    await click(
      Array.from(sectionByLabel(DESCRIPTIVE).querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('إضافة مكون')
      )
    );

    expect(sectionByLabel(DESCRIPTIVE).textContent).toContain('لوز');
    expect(sectionByLabel(REMOVABLE).textContent).not.toContain('لوز');

    await submit();
    const [payload] = onSave.mock.calls[0] as [Record<string, unknown>, string?];
    expect(payload.ingredients).toEqual(['لوز']);
    expect(payload.removableIngredients).toBeUndefined();
  });

  it('adding to the removable list never writes into the descriptive one', async () => {
    await render({ ...baseProduct, ingredients: [], removableIngredients: [] });

    await type(
      sectionByLabel(REMOVABLE).querySelector<HTMLInputElement>('input[aria-label="اسم مكون قابل للاستبعاد"]'),
      'بصل'
    );
    await click(
      Array.from(sectionByLabel(REMOVABLE).querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('إضافة مكون')
      )
    );

    expect(sectionByLabel(REMOVABLE).textContent).toContain('بصل');
    expect(sectionByLabel(DESCRIPTIVE).textContent).not.toContain('بصل');

    await submit();
    const [payload] = onSave.mock.calls[0] as [Record<string, unknown>, string?];
    expect(payload.removableIngredients).toEqual(['بصل']);
    expect(payload.ingredients).toBeUndefined();
  });

  it('starts a new dish with both lists empty', async () => {
    await render(null);

    expect(sectionByLabel(DESCRIPTIVE).textContent).not.toContain('لحم');
    expect(sectionByLabel(REMOVABLE).textContent).not.toContain('بصل');
    // …and the headings are still both there, so the venue can fill either one.
    expect(sectionByLabel(DESCRIPTIVE)).toBeTruthy();
    expect(sectionByLabel(REMOVABLE)).toBeTruthy();
  });
});
