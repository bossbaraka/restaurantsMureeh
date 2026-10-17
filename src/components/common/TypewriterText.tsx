import { useEffect, useMemo, useState, type FC } from 'react';
import { splitIntoGraphemes } from './typewriterTextUtils';

interface TypewriterTextProps {
  text: string;
  /** Start the typewriter only when this visual beat becomes active. */
  active?: boolean;
  /** Delay before the first grapheme is written. */
  delayMs?: number;
  /** Optional utility/theme class for the wrapper. */
  className?: string;
  /** Reuse a parent experience's reduced-motion preference when available. */
  reducedMotion?: boolean;
}

function readReducedMotionPreference(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useSystemReducedMotion(enabled: boolean): boolean {
  const [reduced, setReduced] = useState(readReducedMotionPreference);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, [enabled]);

  return reduced;
}

/**
 * A light, grapheme-aware typewriter reveal with a blinking brand caret.
 * The parent supplies the accessible, complete phrase; this visual fragment
 * stays aria-hidden so assistive technology never announces letter-by-letter.
 */
export const TypewriterText: FC<TypewriterTextProps> = ({
  text,
  active = true,
  delayMs = 0,
  className = '',
  reducedMotion,
}) => {
  const systemReducedMotion = useSystemReducedMotion(reducedMotion === undefined);
  const shouldReduceMotion = reducedMotion ?? systemReducedMotion;
  const graphemes = useMemo(() => splitIntoGraphemes(text), [text]);
  const [visibleText, setVisibleText] = useState('');

  useEffect(() => {
    if (!active || shouldReduceMotion || graphemes.length === 0) return;

    setVisibleText('');
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stepMs = Math.max(20, Math.min(55, Math.round(960 / graphemes.length)));
    const writeNextGrapheme = () => {
      index += 1;
      setVisibleText(graphemes.slice(0, index).join(''));
      if (index < graphemes.length) timer = setTimeout(writeNextGrapheme, stepMs);
    };

    timer = setTimeout(() => {
      timer = setTimeout(writeNextGrapheme, stepMs);
    }, Math.max(0, delayMs));

    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, delayMs, graphemes, shouldReduceMotion]);

  return (
    <span className={`mureeh-typewriter ${className}`.trim()} dir="auto" aria-hidden="true">
      <span className="mureeh-typewriter__measure" aria-hidden="true">
        {text}
      </span>
      <span className="mureeh-typewriter__current">
        {active ? (shouldReduceMotion || graphemes.length === 0 ? text : visibleText) : ''}
        {active && !shouldReduceMotion && graphemes.length > 0 && (
          <span className="mureeh-typewriter__caret" />
        )}
      </span>
    </span>
  );
};
