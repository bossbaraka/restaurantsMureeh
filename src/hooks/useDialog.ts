import { useEffect } from 'react';

/**
 * Shared modal-dialog behaviour (Design-QA findings UX-001 / A11Y-006).
 *
 * Every overlay in the app (product form, cart drawer, onboarding wizard,
 * login, waiter call, bottom sheet…) was a plain `<div>`: no Escape key, no
 * scroll lock, and no dialog semantics. That meant:
 *
 *   - Escape did nothing, so keyboard users could get stuck in a modal whose
 *     only exit was a small icon button.
 *   - The page behind kept scrolling on mobile, so dismissing a sheet often
 *     left the menu scrolled somewhere unexpected.
 *   - Screen readers never announced that a dialog had opened.
 *
 * This hook centralises the behaviour so each overlay opts in with one line
 * instead of re-implementing (and re-forgetting) it.
 *
 * Body scroll locking is reference-counted: nested overlays (e.g. the cart
 * drawer opening a confirmation) must not have the inner one restore
 * scrolling while the outer is still visible.
 */

let scrollLockCount = 0;
let savedOverflow = '';

function lockScroll() {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockScroll() {
  if (typeof document === 'undefined') return;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedOverflow;
  }
}

export interface UseDialogOptions {
  /** Whether the overlay is currently visible. */
  isOpen: boolean;
  /** Called when the user presses Escape. */
  onClose: () => void;
  /** Set false for non-dismissible flows (e.g. a blocking wizard step). */
  closeOnEscape?: boolean;
  /** Set false when the overlay is inline and should not lock the page. */
  lockBodyScroll?: boolean;
}

export function useDialog({
  isOpen,
  onClose,
  closeOnEscape = true,
  lockBodyScroll = true,
}: UseDialogOptions): void {
  useEffect(() => {
    if (!isOpen) return;

    if (lockBodyScroll) lockScroll();

    let onKeyDown: ((e: KeyboardEvent) => void) | undefined;
    if (closeOnEscape) {
      onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      };
      window.addEventListener('keydown', onKeyDown);
    }

    return () => {
      if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
      if (lockBodyScroll) unlockScroll();
    };
  }, [isOpen, onClose, closeOnEscape, lockBodyScroll]);
}

/**
 * Props spread onto a dialog surface to expose correct ARIA semantics.
 * Pair with a heading whose `id` matches `labelledBy`, or pass `label`.
 */
export function dialogProps(opts: { labelledBy?: string; label?: string }) {
  return {
    role: 'dialog' as const,
    'aria-modal': true as const,
    ...(opts.labelledBy
      ? { 'aria-labelledby': opts.labelledBy }
      : { 'aria-label': opts.label }),
  };
}
