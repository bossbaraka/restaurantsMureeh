type GraphemeSegmenter = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => { segment: (input: string) => Iterable<{ segment: string }> };

/** Split text into user-perceived characters; keep Arabic marks attached. */
export function splitIntoGraphemes(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: GraphemeSegmenter }).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) =>
      part.segment,
    );
  }

  // Fallback for older browsers: preserve surrogate pairs and combine Unicode
  // marks (including Arabic harakat) with the preceding base character.
  return Array.from(text).reduce<string[]>((parts, character) => {
    if (/\p{M}/u.test(character) && parts.length > 0) {
      parts[parts.length - 1] += character;
    } else {
      parts.push(character);
    }
    return parts;
  }, []);
}
