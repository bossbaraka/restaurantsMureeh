import React from 'react';
import { Product } from '../../types/restaurant';
import { formatAmount } from '../../utils/formatting';
import { Plus, Minus, Sparkles, Clock, Flame, SlidersHorizontal, Ban, AlertTriangle } from 'lucide-react';
import { ProductImage } from './ProductImage';

export interface ProductCardProps {
  product: Product;
  currency?: string;
  /** Units of this dish already in the cart (drives the inline stepper). */
  cartQuantity?: number;
  /** Above-the-fold cards get eager loading + network priority. */
  priority?: boolean;
  /** Signature dish treatment (spans the grid, brand-tinted surface). */
  featured?: boolean;
  onSelect: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  onQuantityChange: (product: Product, nextQuantity: number) => void;
}

const MemoProductCard: React.FC<ProductCardProps> = ({
  product,
  currency = '₪',
  cartQuantity = 0,
  priority = false,
  featured = false,
  onSelect,
  onQuickAdd,
  onQuantityChange,
}) => {
  const available = product.isAvailable !== false;
  const sizes = product.sizes ?? [];
  const addOns = product.addOns ?? [];
  const removable = product.removableIngredients ?? product.ingredients ?? [];
  const optionCount = sizes.length + addOns.length + removable.length;
  const hasOptions = optionCount > 0;
  const inCart = available && cartQuantity > 0;
  // The card always shows the base (cheapest) price, so qualify it as a
  // starting price whenever another size costs more.
  const startsFrom =
    sizes.length > 1 && sizes.some((s) => (s.priceModifier || s.price || 0) > 0);

  const cardClass = [
    'menu-card',
    featured ? 'menu-card--featured' : '',
    available ? '' : 'menu-card--unavailable',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={cardClass}>
      {/* Media ---------------------------------------------------------------- */}
      <div className="menu-media">
        <ProductImage
          src={product.image}
          alt={product.name}
          priority={priority}
          sizes="(max-width: 640px) 100px, 200px"
        />
        <div className="menu-media__scrim" aria-hidden="true" />

        <div className="menu-media__badges">
          {featured && (
            <span className="menu-badge menu-badge--signature">
              <Sparkles className="w-2.5 h-2.5" />
              طبق الشيف
            </span>
          )}
          {product.badge && available && !featured && (
            <span className="menu-badge menu-badge--brand">
              <Sparkles className="w-2.5 h-2.5" />
              {product.badge}
            </span>
          )}
          {!available && (
            <span className="menu-badge menu-badge--danger">
              <Ban className="w-2.5 h-2.5" />
              غير متوفر
            </span>
          )}
          {!!product.allergens?.length && available && (
            <span className="menu-badge menu-badge--dark" title={`مسببات الحساسية: ${product.allergens.join('، ')}`}>
              <AlertTriangle className="w-2.5 h-2.5" />
              حساسية
            </span>
          )}
        </div>
      </div>

      {/* Body ----------------------------------------------------------------- */}
      <div className="menu-card__body">
        <div>
          <h3 className="menu-card__title">{product.name}</h3>
          {product.nameEn && <p className="menu-card__title-en">{product.nameEn}</p>}
          {product.description && <p className="menu-card__desc">{product.description}</p>}
        </div>

        {(!!product.preparationTimeMinutes || !!product.calories || hasOptions) && (
          <ul className="menu-card__meta">
            {!!product.preparationTimeMinutes && (
              <li className="menu-meta">
                <Clock aria-hidden="true" />
                <span>{product.preparationTimeMinutes} د</span>
              </li>
            )}
            {!!product.calories && (
              <li className="menu-meta">
                <Flame aria-hidden="true" />
                <span>{product.calories} سعرة</span>
              </li>
            )}
            {hasOptions && (
              <li className="menu-meta">
                <SlidersHorizontal aria-hidden="true" />
                <span>{sizes.length > 1 ? `${sizes.length} مقاسات` : `${optionCount} خيارات`}</span>
              </li>
            )}
          </ul>
        )}

        {/* Footer: price + action --------------------------------------------- */}
        <div className="menu-card__footer">
          <div className="menu-price">
            {startsFrom && <span className="menu-price__from">يبدأ من</span>}
            <span className="menu-price__value" dir="ltr">
              {formatAmount(product.price)}
              <span className="menu-price__currency">{currency}</span>
            </span>
          </div>

          <div className="menu-actions">
            {!available ? (
              <span className="text-[11px] font-semibold text-luxury-500">نفد من المطبخ</span>
            ) : inCart ? (
              <div className="menu-qty" role="group" aria-label={`كمية ${product.name}`}>
                <button
                  type="button"
                  onClick={() => onQuantityChange(product, cartQuantity - 1)}
                  aria-label={`إنقاص كمية ${product.name}`}
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="menu-qty__value" aria-live="polite">
                  {cartQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => onQuantityChange(product, cartQuantity + 1)}
                  aria-label={`زيادة كمية ${product.name}`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : hasOptions ? (
              <button
                type="button"
                className="menu-add menu-add--customize"
                onClick={() => onSelect(product)}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>تخصيص</span>
              </button>
            ) : (
              <button
                type="button"
                className="menu-add"
                onClick={() => onQuickAdd(product)}
                aria-label={`إضافة ${product.name} إلى الطلب`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Whole-card affordance (details) — sits under the action controls. */}
      <button
        type="button"
        className="menu-card__hit"
        disabled={!available}
        onClick={() => onSelect(product)}
        aria-label={available ? `عرض تفاصيل ${product.name}` : `${product.name} غير متوفر حالياً`}
        tabIndex={available ? 0 : -1}
      />
    </article>
  );
};

/**
 * The grid re-renders on every cart tick and every keystroke of the search box,
 * so cards only re-render when their own inputs actually changed.
 */
export const ProductCard = React.memo(
  MemoProductCard,
  (prev, next) =>
    prev.product === next.product &&
    prev.cartQuantity === next.cartQuantity &&
    prev.currency === next.currency &&
    prev.priority === next.priority &&
    prev.featured === next.featured &&
    prev.onSelect === next.onSelect &&
    prev.onQuickAdd === next.onQuickAdd &&
    prev.onQuantityChange === next.onQuantityChange
);
