import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Menu pager — the "turn the page" control under the dish grid.
 * ============================================================
 * The category chips already let a guest jump anywhere, but a menu is also
 * read in order, and the page-turn animation deserves an obvious trigger: two
 * large, thumb-reachable buttons that say which section comes next, plus the
 * position in the booklet (`2 / 6`).
 *
 * Purely presentational. The page order, the active index and the turn handler
 * all come from `useMenuPageFlip` via `CustomerLayout`.
 */

export interface MenuPage {
  id: string;
  name: string;
}

interface MenuPagerProps {
  pages: MenuPage[];
  activeIndex: number;
  canTurnPrev: boolean;
  canTurnNext: boolean;
  onTurn: (delta: number) => void;
  /** Shown on phones only: teaches the swipe that does the same thing. */
  swipeHint?: boolean;
}

export const MenuPager: React.FC<MenuPagerProps> = ({
  pages,
  activeIndex,
  canTurnPrev,
  canTurnNext,
  onTurn,
  swipeHint = false,
}) => {
  if (pages.length < 2) return null;

  const current = pages[activeIndex];
  const prev = pages[activeIndex - 1];
  const next = pages[activeIndex + 1];

  return (
    <nav className="menu-pager" aria-label="تقليب صفحات القائمة">
      <button
        type="button"
        className="menu-pager__btn"
        onClick={() => onTurn(-1)}
        disabled={!canTurnPrev}
        aria-label={prev ? `الصفحة السابقة: ${prev.name}` : 'لا توجد صفحة سابقة'}
      >
        {/* RTL: "back" points right, "forward" points left. */}
        <ChevronRight className="menu-pager__icon" aria-hidden="true" />
        <span className="menu-pager__labels">
          <span className="menu-pager__action">السابق</span>
          {prev && <span className="menu-pager__name">{prev.name}</span>}
        </span>
      </button>

      <span className="menu-pager__meta">
        <span className="menu-pager__count" dir="ltr">
          {activeIndex + 1} / {pages.length}
        </span>
        {current && <span className="menu-pager__current">{current.name}</span>}
        {swipeHint && <span className="menu-pager__hint">اسحب أفقياً لتقليب القائمة</span>}
      </span>

      <button
        type="button"
        className="menu-pager__btn menu-pager__btn--forward"
        onClick={() => onTurn(1)}
        disabled={!canTurnNext}
        aria-label={next ? `الصفحة التالية: ${next.name}` : 'لا توجد صفحة تالية'}
      >
        <span className="menu-pager__labels">
          <span className="menu-pager__action">التالي</span>
          {next && <span className="menu-pager__name">{next.name}</span>}
        </span>
        <ChevronLeft className="menu-pager__icon" aria-hidden="true" />
      </button>

      {/* One polite announcement per turn: the visible counter is decorative
          for a screen-reader guest, this is what they actually hear. */}
      <span className="sr-only" role="status">
        {current ? `صفحة ${activeIndex + 1} من ${pages.length}: ${current.name}` : ''}
      </span>
    </nav>
  );
};

export default MenuPager;
