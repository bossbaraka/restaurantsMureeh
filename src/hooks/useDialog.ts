import { useEffect, useRef } from 'react';

/** Shared dismissible-overlay behaviour: nested-safe scroll lock, top-most
 * Escape handling, modal focus entry/trapping, and focus restoration. */
let scrollLockCount = 0;
let savedOverflow = '';
const dialogStack: symbol[] = [];

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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
  if (scrollLockCount === 0) document.body.style.overflow = savedOverflow;
}

function topModalSurface(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
  );
  return dialogs.at(-1) || null;
}

function focusableElements(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true'
  );
}

export interface UseDialogOptions {
  isOpen: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
  lockBodyScroll?: boolean;
  /** Modal dialogs trap focus. Set false only for a deliberately non-modal overlay. */
  trapFocus?: boolean;
}

export function useDialog({
  isOpen,
  onClose,
  closeOnEscape = true,
  lockBodyScroll = true,
  trapFocus = true,
}: UseDialogOptions): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const token = Symbol('dialog');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogStack.push(token);
    if (lockBodyScroll) lockScroll();

    let addedSurfaceTabIndex = false;
    // Capture this dialog's surface so nested-dialog cleanup never mutates a
    // parent or child surface that happens to be topmost later.
    const ownSurface = topModalSurface();
    const focusFrame = window.requestAnimationFrame(() => {
      if (dialogStack.at(-1) !== token || !trapFocus) return;
      const surface = ownSurface;
      if (!surface) return;
      const target = surface.querySelector<HTMLElement>('[data-autofocus]') || focusableElements(surface)[0];
      if (target) target.focus();
      else {
        if (!surface.hasAttribute('tabindex')) {
          surface.setAttribute('tabindex', '-1');
          addedSurfaceTabIndex = true;
        }
        surface.focus();
      }
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== token) return;
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !trapFocus) return;

      const surface = topModalSurface();
      if (!surface) return;
      const items = focusableElements(surface);
      if (items.length === 0) {
        event.preventDefault();
        surface.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !surface.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !surface.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      const index = dialogStack.lastIndexOf(token);
      if (index >= 0) dialogStack.splice(index, 1);
      if (lockBodyScroll) unlockScroll();
      if (addedSurfaceTabIndex) ownSurface?.removeAttribute('tabindex');
      // Do not pull focus out of a still-open child if a parent is removed.
      if (opener?.isConnected && index === dialogStack.length) opener.focus();
    };
  }, [isOpen, closeOnEscape, lockBodyScroll, trapFocus]);
}

export function dialogProps(opts: { labelledBy?: string; label?: string }) {
  return {
    role: 'dialog' as const,
    'aria-modal': true as const,
    ...(opts.labelledBy
      ? { 'aria-labelledby': opts.labelledBy }
      : { 'aria-label': opts.label }),
  };
}
