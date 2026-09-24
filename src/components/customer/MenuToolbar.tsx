import React from 'react';
import { ArrowDownWideNarrow, ChefHat, LayoutGrid, Rows3 } from 'lucide-react';

export type MenuSortKey = 'menu' | 'featured' | 'price-asc' | 'price-desc' | 'fastest';
export type MenuLayout = 'list' | 'grid';

interface MenuToolbarProps {
  shownCount: number;
  totalCount: number;
  sort: MenuSortKey;
  onSortChange: (sort: MenuSortKey) => void;
  availableOnly: boolean;
  onAvailableOnlyChange: (value: boolean) => void;
  layout: MenuLayout;
  onLayoutChange: (layout: MenuLayout) => void;
}

const SORT_OPTIONS: { value: MenuSortKey; label: string }[] = [
  { value: 'menu', label: 'ترتيب القائمة' },
  { value: 'featured', label: 'المميّز أولاً' },
  { value: 'price-asc', label: 'السعر: من الأقل' },
  { value: 'price-desc', label: 'السعر: من الأعلى' },
  { value: 'fastest', label: 'الأسرع تحضيراً' },
];

/**
 * Menu controls: ordering, availability filter and density switch.
 * Purely presentational — the filtering/sorting math lives in CustomerLayout
 * so it stays memoized once for the whole grid.
 *
 * NOTE (Option A): the dishes count is intentionally NOT rendered here any
 * more — it lives once, in the section header below the rail. `shownCount`
 * and `totalCount` stay on the props contract untouched so the single caller
 * (CustomerLayout) and every consumer of the type keep compiling unchanged.
 */
export const MenuToolbar: React.FC<MenuToolbarProps> = ({
  sort,
  onSortChange,
  availableOnly,
  onAvailableOnlyChange,
  layout,
  onLayoutChange,
}) => {
  return (
    <div className="menu-toolbar">
      <div className="menu-toolbar__group">
        <button
          type="button"
          className="menu-toggle"
          data-on={availableOnly}
          aria-pressed={availableOnly}
          aria-label="إظهار الأطباق المتوفرة فقط"
          onClick={() => onAvailableOnlyChange(!availableOnly)}
          title="إظهار الأطباق المتوفرة فقط"
        >
          <ChefHat className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden xs:inline sm:inline">المتوفر فقط</span>
        </button>

        <label className="relative inline-flex items-center">
          <ArrowDownWideNarrow
            className="w-3.5 h-3.5 absolute right-2 pointer-events-none text-m-text-subtle"
            aria-hidden="true"
          />
          <span className="sr-only">ترتيب الأطباق</span>
          <select
            className="menu-select"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as MenuSortKey)}
            style={{ paddingInlineStart: '1.6rem' }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="menu-layout-switch" role="group" aria-label="طريقة العرض">
          <button
            type="button"
            data-on={layout === 'list'}
            aria-pressed={layout === 'list'}
            aria-label="عرض قائمة"
            title="عرض قائمة"
            onClick={() => onLayoutChange('list')}
          >
            <Rows3 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-on={layout === 'grid'}
            aria-pressed={layout === 'grid'}
            aria-label="عرض شبكي"
            title="عرض شبكي"
            onClick={() => onLayoutChange('grid')}
          >
            <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};


