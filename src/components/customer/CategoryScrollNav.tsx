import React, { useEffect, useMemo, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Search } from 'lucide-react';

/**
 * Horizontal category rail. Sticky under the header, themed by the tenant
 * palette, and cheap to re-render: availability counts are derived from a
 * single pass over the menu instead of one filter per chip.
 */
export const CategoryScrollNav: React.FC = () => {
  const { categories, selectedCategoryId, setSelectedCategoryId, products, searchQuery } =
    useRestaurant();
  const trackRef = useRef<HTMLDivElement>(null);

  const availableCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      if (product.isAvailable === false) continue;
      counts.set(product.categoryId, (counts.get(product.categoryId) || 0) + 1);
    }
    return counts;
  }, [products]);

  // Keep the active chip inside the viewport while browsing with the keyboard.
  useEffect(() => {
    const activeEl = trackRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeEl) return;
    const track = trackRef.current;
    if (!track) return;
    const overflow = track.scrollWidth - track.clientWidth;
    if (overflow <= 4) return;
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedCategoryId]);

  if (searchQuery) {
    return (
      <div className="mb-4 flex items-center gap-1.5 text-xs text-luxury-400 px-1">
        <Search className="w-3.5 h-3.5 brand-text" aria-hidden="true" />
        <span>
          نتائج البحث عن <span className="font-bold brand-text">“{searchQuery}”</span>
        </span>
      </div>
    );
  }

  if (categories.length === 0) return null;

  return (
    <div className="menu-cats">
      <div ref={trackRef} className="menu-cats__track" role="tablist" aria-label="أقسام القائمة">
        {categories.map((category) => {
          const isSelected = category.id === selectedCategoryId;
          const count = availableCountByCategory.get(category.id) || 0;
          const icon = category.icon && category.icon.trim().length <= 4 ? category.icon.trim() : null;

          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              data-active={isSelected}
              onClick={() => setSelectedCategoryId(category.id)}
              className="menu-chip"
            >
              {icon && (
                <span aria-hidden="true" className="text-[13px] leading-none">
                  {icon}
                </span>
              )}
              <span>{category.name}</span>
              <span className="menu-chip__count">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
