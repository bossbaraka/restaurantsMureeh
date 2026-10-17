import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TypewriterText } from '../components/common/TypewriterText';
import { splitIntoGraphemes } from '../components/common/typewriterTextUtils';

describe('Arabic-safe typewriter text', () => {
  it('keeps Arabic harakat attached to their base grapheme', () => {
    const text = 'أَهْلًا بِكُمْ';
    const graphemes = splitIntoGraphemes(text);

    expect(graphemes.join('')).toBe(text);
    expect(graphemes).toContain('أَ');
    expect(graphemes).toContain('هْ');
    expect(graphemes).toContain('لً');
    expect(graphemes).toContain('ا');
    expect(graphemes).toContain('بِ');
    expect(graphemes).toContain('كُ');
  });

  it('renders a fixed-width, assistive-technology-hidden visual layer with a caret', () => {
    const markup = renderToStaticMarkup(<TypewriterText text="أهلاً بكم" active />);

    expect(markup).toContain('class="mureeh-typewriter"');
    expect(markup).toContain('class="mureeh-typewriter__measure"');
    expect(markup).toContain('أهلاً بكم');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('mureeh-typewriter__caret');
  });

  it('leaves the complete accessible greeting to its parent instead of exposing letter-by-letter updates', () => {
    const markup = renderToStaticMarkup(
      <h1>
        <span className="sr-only">أهلاً بكم في مطعم الأرز</span>
        <TypewriterText text="أهلاً بكم في مطعم الأرز" />
      </h1>,
    );

    expect(markup).toContain('<span class="sr-only">أهلاً بكم في مطعم الأرز</span>');
    expect(markup.match(/أهلاً بكم في مطعم الأرز/g)).toHaveLength(2);
    expect(markup).toContain('aria-hidden="true"');
  });
});
