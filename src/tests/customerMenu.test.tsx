import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProductCard } from '../components/customer/ProductCard';
import { MenuToolbar } from '../components/customer/MenuToolbar';
import { ProductImage } from '../components/customer/ProductImage';
import { formatAmount, formatPrice } from '../utils/formatting';
import type { Product } from '../types/restaurant';

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
  preparationTimeMinutes: 35,
  calories: 980,
};

const render = (ui: React.ReactElement) => renderToStaticMarkup(ui);

const cardProps = {
  currency: '₪',
  cartQuantity: 0,
  priority: false,
  featured: false,
  onSelect: () => {},
  onQuickAdd: () => {},
  onQuantityChange: () => {},
};

describe('ProductCard', () => {
  it('renders the dish identity, meta chips and themed price', () => {
    const html = render(<ProductCard {...cardProps} product={baseProduct} />);

    expect(html).toContain('menu-card');
    expect(html).toContain('منسف الديوان الملكي');
    expect(html).toContain('Diwan Mansaf');
    expect(html).toContain('لحم ضأن مطهو ببطء');
    expect(html).toContain('35 د');
    expect(html).toContain('980 سعرة');
    // Price + currency are split so RTL never reorders the digits.
    expect(html).toContain('89');
    expect(html).toContain('menu-price__currency');
    expect(html).toContain('dir="ltr"');
  });

  it('shows a one-tap add button for a dish without options', () => {
    const onQuickAdd = vi.fn();
    const html = render(
      <ProductCard {...cardProps} product={baseProduct} onQuickAdd={onQuickAdd} />
    );

    expect(html).toContain('إضافة');
    expect(html).toContain(`aria-label="إضافة ${baseProduct.name} إلى الطلب"`);
    expect(html).not.toContain('تخصيص');
  });

  it('routes dishes with variants to the customization sheet', () => {
    const withSizes: Product = {
      ...baseProduct,
      sizes: [
        { id: 's1', name: 'عادي', priceModifier: 0 },
        { id: 's2', name: 'كبير', priceModifier: 14 },
      ],
    };
    const html = render(<ProductCard {...cardProps} product={withSizes} />);

    expect(html).toContain('تخصيص');
    expect(html).toContain('2 مقاسات');
    expect(html).toContain('يبدأ من');
  });

  it('renders an inline stepper once the dish is in the cart', () => {
    const html = render(<ProductCard {...cardProps} product={baseProduct} cartQuantity={3} />);

    expect(html).toContain('menu-qty');
    expect(html).toContain('>3<');
    expect(html).toContain(`aria-label="زيادة كمية ${baseProduct.name}"`);
    expect(html).toContain(`aria-label="إنقاص كمية ${baseProduct.name}"`);
    // The stepper replaces the add button — never both at once.
    expect(html).not.toContain('menu-add');
  });

  it('locks unavailable dishes instead of letting them be ordered', () => {
    const html = render(
      <ProductCard {...cardProps} product={{ ...baseProduct, isAvailable: false }} />
    );

    expect(html).toContain('menu-card--unavailable');
    expect(html).toContain('غير متوفر');
    expect(html).toContain('نفد من المطبخ');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('menu-add');
    expect(html).not.toContain('menu-qty');
  });

  it('flags allergens and the signature treatment', () => {
    const html = render(
      <ProductCard
        {...cardProps}
        product={{ ...baseProduct, allergens: ['مكسرات'], isFeatured: true }}
        featured
      />
    );

    expect(html).toContain('menu-card--featured');
    expect(html).toContain('طبق الشيف');
    expect(html).toContain('مسببات الحساسية: مكسرات');
  });

  it('prioritizes above-the-fold images and defers the rest', () => {
    const eager = render(<ProductCard {...cardProps} product={baseProduct} priority />);
    const lazy = render(<ProductCard {...cardProps} product={baseProduct} />);

    expect(eager).toContain('loading="eager"');
    expect(eager).toMatch(/fetchpriority="high"/i);
    // React 19 also preloads images it is told are high priority.
    expect(eager).toContain('rel="preload"');
    expect(lazy).toContain('loading="lazy"');
    expect(lazy).not.toMatch(/fetchpriority="high"/i);
  });

  it('uses the tenant currency', () => {
    const html = render(<ProductCard {...cardProps} product={baseProduct} currency="JD" />);
    expect(html).toContain('JD');
  });
});

/**
 * The customization decision has ONE definition:
 *
 *   sizes.length > 0 || addOns.length > 0 || removableIngredients.length > 0
 *
 * `ingredients` is the dish's descriptive composition (metadata): it is NOT a
 * customization option and must never be used as a fallback source for
 * `removableIngredients`. The previous `removableIngredients ?? ingredients`
 * fallback turned every dish that carried only a composition list — including
 * every dish saved before the manager form stopped writing the same array into
 * both columns — into a «تخصيص» card.
 */
describe('ProductCard — customization semantics', () => {
  /** The label of the single action button the card renders. */
  const cta = (html: string): string => {
    const found = html.match(/<span>(تخصيص|إضافة)<\/span>/);
    return found ? found[1] : 'NONE';
  };

  const withFields = (fields: Partial<Product>): Product => ({ ...baseProduct, ...fields });

  const size = { id: 's1', name: 'كبير', priceModifier: 5 };
  const addOn = { id: 'a1', name: 'جبنة إضافية', price: 3 };

  const cases: Array<[string, Partial<Product>, string]> = [
    ['ingredients only', { ingredients: ['لحم', 'بصل'] }, 'إضافة'],
    ['ingredients + removableIngredients=[]', { ingredients: ['لحم'], removableIngredients: [] }, 'إضافة'],
    ['ingredients + removableIngredients undefined', { ingredients: ['لحم'] }, 'إضافة'],
    ['ingredients + removableIngredients null', { ingredients: ['لحم'], removableIngredients: null as never }, 'إضافة'],
    ['removableIngredients only', { removableIngredients: ['بصل'] }, 'تخصيص'],
    ['sizes only', { sizes: [size] }, 'تخصيص'],
    ['addOns only', { addOns: [addOn] }, 'تخصيص'],
    ['sizes + addOns', { sizes: [size], addOns: [addOn] }, 'تخصيص'],
    ['ingredients + sizes', { ingredients: ['لحم'], sizes: [size] }, 'تخصيص'],
    [
      'all three customization sources',
      { ingredients: ['لحم'], removableIngredients: ['بصل'], sizes: [size], addOns: [addOn] },
      'تخصيص',
    ],
    ['everything empty', { ingredients: [], removableIngredients: [], sizes: [], addOns: [] }, 'إضافة'],
  ];

  it.each(cases)('%s → %s', (_label, fields, expected) => {
    const html = render(<ProductCard {...cardProps} product={withFields(fields)} />);
    expect(cta(html)).toBe(expected);
    // The CTA class travels with the label — never a customize button on a
    // plain «إضافة» dish, nor the reverse.
    expect(html.includes('menu-add--customize')).toBe(expected === 'تخصيص');
  });

  it('does not count descriptive ingredients in the options chip', () => {
    const plain = render(
      <ProductCard {...cardProps} product={withFields({ ingredients: ['لحم', 'بصل', 'طماطم'] })} />
    );
    // No meta chip at all: nothing customizable to advertise.
    expect(plain).not.toContain('خيارات');
    expect(plain).not.toContain('مقاسات');

    const removable = render(
      <ProductCard {...cardProps} product={withFields({ removableIngredients: ['بصل', 'طماطم'] })} />
    );
    expect(removable).toContain('2 خيارات');
  });
});

describe('MenuToolbar', () => {
  const toolbarProps = {
    shownCount: 12,
    totalCount: 14,
    sort: 'price-asc' as const,
    onSortChange: () => {},
    availableOnly: true,
    onAvailableOnlyChange: () => {},
    layout: 'grid' as const,
    onLayoutChange: () => {},
  };

  it('renders no dishes count — Option A keeps it in the section head only', () => {
    const html = render(<MenuToolbar {...toolbarProps} />);
    // The removed count group shared its class with the controls group, so
    // exactly ONE group may remain: no duplicate count can silently return.
    expect(html.split('menu-toolbar__group').length - 1).toBe(1);
    // ...while every control stays rendered.
    expect(html).toContain('menu-toggle');
    expect(html).toContain('menu-select');
    expect(html).toContain('menu-layout-switch');
  });

  it('exposes accessible state on every control', () => {
    const html = render(<MenuToolbar {...toolbarProps} />);
    expect(html).toContain('aria-pressed="true"'); // availability filter is on
    expect(html).toContain('value="price-asc"'); // sort reflects the current key
    expect(html).toContain('aria-label="عرض شبكي"');
    // The chosen density is marked on its own switch button.
    expect(html).toContain('menu-layout-switch');
    expect(html).toContain('aria-label="عرض شبكي" title="عرض شبكي"');
  });

  it('marks the inactive density option as unpressed', () => {
    const html = render(<MenuToolbar {...toolbarProps} layout="list" />);
    expect(html).toContain('aria-label="عرض قائمة" title="عرض قائمة"');
    expect(html).toContain('data-on="false"');
  });
});

describe('menu section head count (Option A)', () => {
  const layoutSource = () =>
    readFileSync(
      fileURLToPath(new URL('../components/customer/CustomerLayout.tsx', import.meta.url)),
      'utf8'
    );

  it('owns the dishes count: one grouped metadata line with the shown/total format', () => {
    const layout = layoutSource();
    // The count heads the title block it describes.
    expect(layout).toContain('menu-section-head__count');
    expect(layout).toContain('<strong>{visibleProducts.length}</strong> طبق');
    // While a filter narrows the section, the shown/total pair is preserved.
    expect(layout).toContain('visibleProducts.length !== scopedProducts.length');
    expect(layout).toContain('<strong>{visibleProducts.length}</strong> من {scopedProducts.length} طبق');
    // The whole head (count included) stays hidden during search.
    expect(layout).toContain('!isSearching && activeCategoryObj');
    expect(layout.indexOf('!isSearching && activeCategoryObj')).toBeLessThan(
      layout.indexOf('menu-section-head__count')
    );
  });
});

describe('ProductImage', () => {
  it('holds a shimmer placeholder until the bitmap lands', () => {
    const html = render(<ProductImage src="https://example.test/a.jpg" alt="طبق" />);
    expect(html).toContain('menu-img__skeleton');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('menu-img__fallback');
  });

  it('falls back to a dish icon when there is no image', () => {
    const html = render(<ProductImage src="" alt="طبق" />);
    expect(html).toContain('menu-img__fallback');
    expect(html).not.toContain('<img');
  });
});

describe('price formatting', () => {
  it('keeps the legacy symbol-first format and accepts a tenant currency', () => {
    expect(formatPrice(89)).toBe('₪89');
    expect(formatPrice(1240.5)).toBe('₪1,240.50');
    expect(formatPrice(89, 'JD')).toBe('JD89');
    expect(formatAmount(1240.5)).toBe('1,240.50');
    expect(formatAmount(89)).toBe('89');
  });
});
