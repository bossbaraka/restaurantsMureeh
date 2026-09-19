import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { LiveMenuStage } from '../display/LiveMenuStage';

/**
 * Display Menu (عرض للقراءة فقط) — the Live Menu bound to the tenant context.
 *
 * Mounted by `CustomerLayout` when the URL asks for the board
 * (`/r/{slug}?view=display` or `?mode=tv`), before any table gate, so it never
 * creates a session, never mounts a cart and can be filmed or screen-recorded
 * safely. All of the presentation lives in `LiveMenuStage`; this file is only
 * the wiring between the restaurant context and the screen.
 */
export const DisplayMenu: React.FC = () => {
  const { products, categories, currentRestaurant, showToast } = useRestaurant();
  return (
    <LiveMenuStage
      restaurant={currentRestaurant}
      categories={categories}
      products={products}
      onToast={showToast}
    />
  );
};

export default DisplayMenu;
