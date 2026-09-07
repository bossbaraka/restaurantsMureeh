import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from 'react';

/** Observe when an element enters the viewport (fires once). */
export function useInView<T extends HTMLElement = HTMLDivElement>(threshold = 0.2) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}

/** Scroll-reveal wrapper — fades & slides children in when scrolled into view. */
export const Reveal: FC<{
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}> = ({ children, delay = 0, y = 30, className = '' }) => {
  const { ref, inView } = useInView<HTMLDivElement>(0.1);
  const style: CSSProperties = {
    transitionDelay: `${delay}ms`,
    ...(inView ? null : { transform: `translateY(${y}px)` }),
  };
  return (
    <div
      ref={ref}
      style={style}
      className={`saas-reveal${inView ? ' is-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
};

/** Number that eases toward `target` whenever it changes. */
export function useAnimatedNumber(target: number, duration = 650): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = target;
    };
  }, [target, duration]);

  return value;
}

/** Animated number with custom formatting (ideal for live calculators). */
export const AnimatedNumber: FC<{
  value: number;
  format?: (n: number) => string;
  className?: string;
}> = ({
  value,
  format = (n) => Math.round(n).toLocaleString('en-US'),
  className = '',
}) => {
  const animated = useAnimatedNumber(value);
  return <span className={className}>{format(animated)}</span>;
};

/** Counts up from 0 to `to` the first time it scrolls into view. */
export const CountUp: FC<{
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}> = ({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1500,
  className = '',
}) => {
  const { ref, inView } = useInView<HTMLSpanElement>(0.4);
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(to * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
};

/** Consistent section heading: eyebrow pill + title + subtitle. */
export const SectionHeading: FC<{
  eyebrow: string;
  title: ReactNode;
  sub?: string;
}> = ({ eyebrow, title, sub }) => (
  <Reveal className="text-center max-w-2xl mx-auto space-y-4 mb-12 sm:mb-16">
    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#0072BC]/10 border border-[#0072BC]/30 text-[#38BDF8] text-[11px] font-bold tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] animate-saas-blink" />
      {eyebrow}
    </span>
    <h2 className="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">
      {title}
    </h2>
    {sub && (
      <p className="text-sm sm:text-base text-slate-300/90 leading-relaxed">{sub}</p>
    )}
  </Reveal>
);
