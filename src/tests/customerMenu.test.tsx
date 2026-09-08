import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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

  it('reports the filtered slice of the section', () => {
    const html = render(<MenuToolbar {...toolbarProps} />);
    expect(html).toContain('12');
    expect(html).toContain('14');
    expect(html).toContain('طبق');
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
