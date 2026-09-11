import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  X,
  ArrowDown,
  ArrowRight,
  ArrowLeft,
  Search,
  ShoppingBag,
  ChefHat,
  Check,
  Sparkles,
} from 'lucide-react';
import { GUIDE_OPEN_EVENT } from './guideBus';
import { useRestaurant } from '../../context/RestaurantContext';

/**
 * Interactive customer onboarding tour.
 *
 * A coach-mark walkthrough that actually navigates the guest through the three
 * screens of the ordering flow — menu → cart → order tracking — instead of
 * merely pointing at controls on the first screen. Each step opens the right
 * drawer (or returns to the menu), then highlights its target so the guest
 * learns by seeing the real screen. It is opened automatically once per tab
 * and can be re-opened at any time through `openCustomerGuide()` (bound to the
 * "دليل الاستخدام" button in the header, on both desktop and mobile).
 */

const GUIDE_SEEN_KEY = 'merar_customer_guide_seen';

interface GuideStep {
  id: string;
  /** Which customer screen this step belongs to (drives drawer open/close). */
  screen: 'menu' | 'cart' | 'tracking';
  target: string; // CSS selector for the target element
  placement: 'top' | 'bottom' | 'left' | 'right';
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'menu',
    screen: 'menu',
    target: '[data-guide="search"]',
    placement: 'bottom',
    title: 'تصفح القائمة وأضف أطباقك',
    description: 'ابحث عن طبقك أو تصفّح الأقسام، ثم اضغط على أي طبق لإضافته إلى سلتك.',
    icon: Search,
  },
  {
    id: 'cart',
    screen: 'cart',
    target: '[data-guide="cart-panel"]',
    placement: 'bottom',
    title: 'راجع سلتك وأكّد الطلب',
    description: 'كل ما أضفته يظهر هنا. عدّل الكميات ثم اضغط «تأكيد الطلب» لإرساله للمطبخ.',
    icon: ShoppingBag,
  },
  {
    id: 'tracking',
    screen: 'tracking',
    target: '[data-guide="tracking-panel"]',
    placement: 'bottom',
    title: 'تابع طلبك لحظة بلحظة',
    description: 'بعد الإرسال تابع مراحل طلبك هنا (استلام ← تحضير ← جاهز ← تقديم).',
    icon: ChefHat,
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getRect(selector: string): Rect | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  // Pick the first *visible* match (desktop and mobile controls share the same
  // data-guide key; the hidden variant reports a 0×0 box).
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
  }
  return null;
}

const ARROW_PAD = 14;

export const CustomerGuideOverlay: React.FC = () => {
  const { setIsCartOpen, setIsOrderTrackingOpen } = useRestaurant();

  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 320,
  });

  const activeStep = GUIDE_STEPS[stepIndex] ?? GUIDE_STEPS[GUIDE_STEPS.length - 1];

  const measure = useCallback(() => {
    if (!activeStep) return;
    const rect = getRect(activeStep.target);
    setTargetRect(rect);
    if (rect) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Keep the tooltip within the viewport on narrow phones.
      const width = Math.min(320, vw - 16);
      let top = rect.top;
      let left = rect.left;

      const desiredLeft = rect.left + rect.width / 2 - width / 2;
      left = Math.max(8, Math.min(vw - width - 8, desiredLeft));

      if (activeStep.placement === 'bottom') {
        top = rect.top + rect.height + ARROW_PAD;
        if (top + 190 > vh) top = Math.max(8, rect.top - 190 - ARROW_PAD);
      } else if (activeStep.placement === 'top') {
        top = rect.top - 190 - ARROW_PAD;
        if (top < 8) top = rect.top + rect.height + ARROW_PAD;
      } else {
        top = rect.top + rect.height / 2 - 95;
        if (top < 8) top = 8;
        if (top + 190 > vh) top = vh - 198;
      }
      setTooltipPos({ top, left, width });
    }
  }, [activeStep]);

  // Open/close the right customer screen for the active step, then measure its
  // target once the drawer has mounted (the slide-in animation needs a beat).
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (activeStep.screen === 'cart') {
      setIsCartOpen(true);
      setIsOrderTrackingOpen(false);
    } else if (activeStep.screen === 'tracking') {
      setIsCartOpen(false);
      setIsOrderTrackingOpen(true);
    } else {
      setIsCartOpen(false);
      setIsOrderTrackingOpen(false);
    }
    const t = window.setTimeout(measure, 260);
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [isOpen, stepIndex, activeStep, measure, setIsCartOpen, setIsOrderTrackingOpen]);

  const open = useCallback(() => {
    setStepIndex(0);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Return the guest to the menu screen rather than leaving a drawer open.
    setIsCartOpen(false);
    setIsOrderTrackingOpen(false);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(GUIDE_SEEN_KEY, 'true');
      } catch {
        /* noop */
      }
    }
  }, [setIsCartOpen, setIsOrderTrackingOpen]);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= GUIDE_STEPS.length - 1) {
        close();
        return i;
      }
      return i + 1;
    });
  }, [close]);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  // Listen for external open requests (header "دليل الاستخدام" button).
  useEffect(() => {
    const handler = () => open();
    window.addEventListener(GUIDE_OPEN_EVENT, handler);
    return () => window.removeEventListener(GUIDE_OPEN_EVENT, handler);
  }, [open]);

  // First-run auto-open (once per tab).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!sessionStorage.getItem(GUIDE_SEEN_KEY)) {
        const t = window.setTimeout(() => open(), 1600);
        return () => window.clearTimeout(t);
      }
    } catch {
      /* noop */
    }
  }, [open]);

  // Lock body scroll while the guide is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen || !activeStep) return null;

  const StepIcon = activeStep.icon;
  const showTooltip = !!targetRect;

  // Arrow direction depends on where the tooltip sits relative to the target.
  const tooltipCenterY = tooltipPos.top + 95;
  const targetCenterY = (targetRect?.top ?? 0) + (targetRect?.height ?? 0) / 2;
  const arrowPointsDown = tooltipCenterY < targetCenterY;

  return (
    <div className="fixed inset-0 z-[120] select-none" dir="rtl">
      {/* Dim backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />

      {/* Spotlight ring cut around the target */}
      {targetRect && (
        <div
          className="guide-spotlight absolute rounded-2xl pointer-events-none"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      )}

      {/* Animated arrow + tooltip */}
      {showTooltip && (
        <div
          ref={tooltipRef}
          className="absolute z-10"
          style={{ top: tooltipPos.top, left: tooltipPos.left, width: tooltipPos.width }}
        >
          {/* Arrow pointing at the target */}
          <div
            className={`guide-arrow mx-auto ${arrowPointsDown ? 'mb-1' : 'mt-1 order-last'}`}
            style={arrowPointsDown ? {} : { transform: 'rotate(180deg)' }}
          >
            <ArrowDown className="w-8 h-8 text-[var(--brand-primary-strong)]" />
          </div>

          <div className="bg-luxury-900/95 border border-[rgb(var(--brand-primary-strong-rgb)/0.45)] backdrop-blur-xl rounded-2xl p-4 shadow-[0_18px_50px_rgba(0,0,0,0.7)] space-y-2.5 text-right">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.12)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)] shrink-0">
                <StepIcon className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-luxury-50 font-serif">{activeStep.title}</h4>
                <p className="text-[11px] text-luxury-400 mt-0.5 leading-relaxed">{activeStep.description}</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between pt-1 border-t border-luxury-800/80">
              <div className="flex items-center gap-1">
                {GUIDE_STEPS.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setStepIndex(i)}
                    aria-label={`الخطوة ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${i === stepIndex ? 'w-5 bg-[var(--brand-primary-strong)]' : 'w-1.5 bg-luxury-700 hover:bg-luxury-600'}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={close}
                  className="px-2.5 py-1.5 rounded-lg text-luxury-400 hover:text-luxury-200 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  تخطي
                </button>
                {stepIndex > 0 && (
                  <button
                    onClick={prev}
                    className="px-2.5 py-1.5 rounded-lg bg-luxury-850 hover:bg-luxury-800 text-luxury-200 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    السابق
                  </button>
                )}
                <button
                  onClick={next}
                  className="px-3 py-1.5 rounded-lg brand-cta font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  {stepIndex >= GUIDE_STEPS.length - 1 ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      فهمت
                    </>
                  ) : (
                    <>
                      التالي
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header hint + close */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-luxury-950/80 border border-luxury-750 text-luxury-300 text-[11px] font-bold">
          <Sparkles className="w-3.5 h-3.5 text-[var(--brand-primary-strong)]" />
          جولة تعريفية — الخطوة {stepIndex + 1} من {GUIDE_STEPS.length}
        </span>
        <button
          onClick={close}
          className="p-2 rounded-full bg-luxury-950/80 border border-luxury-750 text-luxury-300 hover:text-white transition-colors cursor-pointer"
          aria-label="إغلاق الدليل"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
