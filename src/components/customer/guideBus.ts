/**
 * Event bus for the interactive customer guide.
 *
 * Kept in its own module (no components) so the `openCustomerGuide` trigger
 * can be imported anywhere without breaking React Fast Refresh on the overlay
 * component file.
 */
export const GUIDE_OPEN_EVENT = 'mureeh:guide:open';

/** Open the guide from anywhere (header button, etc.). */
export function openCustomerGuide(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUIDE_OPEN_EVENT));
}
