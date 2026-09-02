import React, { useRef, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Sparkles } from 'lucide-react';

export const CategoryScrollNav: React.FC = () => {
  const { categories, selectedCategoryId, setSelectedCategoryId, products, searchQuery } = useRestaurant();
  const navContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll selected category into view
  useEffect(() => {
    if (navContainerRef.current) {
      const activeEl = navContainerRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [selectedCategoryId]);

  if (searchQuery) {
    return (
      <div className="mb-4 text-xs text-luxury-400 text-right px-1">
        نتائج البحث عن: <span className="text-gold-400 font-semibold">"{searchQuery}"</span>
      </div>
    );
  }

  return (
    <div className="sticky top-[118px] z-20 bg-luxury-950/95 backdrop-blur-md py-2.5 -mx-4 px-4 sm:mx-0 sm:px-0 border-b border-luxury-850/80 mb-6">
      <div
        ref={navContainerRef}
        className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth py-1"
      >
        {categories.map((category) => {
          const isSelected = category.id === selectedCategoryId;
          const count = products.filter((p) => p.categoryId === category.id && p.isAvailable).length;

          return (
            <button
              key={category.id}
              data-active={isSelected}
              onClick={() => setSelectedCategoryId(category.id)}
              className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 select-none ${
                isSelected
                  ? 'bg-gold-500 text-luxury-950 shadow-gold-glow font-bold'
                  : 'bg-luxury-900 text-luxury-300 hover:text-luxury-100 hover:bg-luxury-850 border border-luxury-800'
              }`}
            >
              <span>{category.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  isSelected ? 'bg-luxury-950/20 text-luxury-950 font-bold' : 'bg-luxury-800 text-luxury-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
