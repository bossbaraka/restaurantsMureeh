/**
 * Arabic-aware search helpers (in-app, manager console).
 *
 * Why this exists
 * ===============
 * The management search boxes used a raw
 * `value.toLowerCase().includes(query)` match. For Arabic
 * restaurant vocabulary that misses real hits:
 *
 *   - أ / إ / آ / ٱ vs ا  — "أكلة" never matches "اكله" typed plainly
 *   - ة vs ه              — "كنافة" vs "كنافه", "طلبات" vs "طلبات"
 *   - ى vs ي              — "مطاعم" vs "مطاعي"… dialects differ
 *   - التشكيل (tashkeel)  — "مُنْدي" vs "مندي"
 *   - التطويل (tatweel ـ) — copy-paste artifacts
 *   - ؤ /ئ                — hamza on waw/yaa variants
 *
 * …and even when a row matched, the list kept its database
 * order, so the *best* match could land on page two — the
 * owner typing "شاورما" wanted the shawarma dish first, not
 * "وجبة شاورما لحم" from 2024.
 *
 * This module normalizes both sides and ranks matches:
 * exact > prefix > word-boundary > substring, multi-word
 * queries require every token to match somewhere (AND) and
 * sum their best scores. Stable sort keeps equal scores in
 * their original (usually newest-first) order.
 *
 * Pure functions only — no React, no types from the app,
 * safe to unit-test in isolation.
 */

/** Tashkeel (harakat), sukun, shadda, tatweel and the
 *  superscript alef — all invisible to meaning. */
const DIACRITICS_AND_TATWEEL =
  /[\u064B-\u0652\u0670\u06D6-\u06ED\u0640]/g;

/**
 * Normalise Arabic text for matching:
 * unify alef forms, ta-marbuta, magidiyah alef, hamza
 * carriers, strip diacritics/tatweel, collapse whitespace.
 */
export function normalizeArabic(input: string): string {
  return input
    .toLowerCase()
    // alef variants → plain alef
    .replace(/[أإآٱا]/g, 'ا')
    // ta-marbuta → ha (كنافة = كنافه)
    .replace(/ة/g, 'ه')
    // magidiyah alef → yaa (مطاعم = مطاعم)
    .replace(/ى/g, 'ي')
    // hamza on waw/yaa → their base letters
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(DIACRITICS_AND_TATWEEL, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Relevance score of one normalized token against one
 * normalized value (0 = no match).
 */
export function matchScore(
  token: string,
  normalizedValue: string,
): number {
  if (!token || !normalizedValue) return 0;
  if (normalizedValue === token) return 100; // exact name
  if (normalizedValue.startsWith(token)) return 80; // prefix
  if (normalizedValue.includes(` ${token}`) || normalizedValue.includes(`${token} `)) {
    return 60; // whole-word hit inside the text
  }
  if (normalizedValue.includes(token)) return 40; // substring
  return 0;
}

/**
 * Filter + rank a list by an Arabic query.
 *
 * @param items      the rows to search
 * @param query      the raw search-box text
 * @param extractors one or more string fields per row
 *                   (name, nameEn, description, …). Every
 *                   extractor is consulted; the best score
 *                   per token wins.
 * @returns matching rows, strongest match first. An empty
 *          or whitespace-only query returns the input list
 *          untouched (same contract the old `.filter` had).
 */
export function rankByQuery<T>(
  items: ReadonlyArray<T>,
  query: string,
  extractors: ReadonlyArray<(item: T) => string | null | undefined>,
): T[] {
  const tokens = normalizeArabic(query)
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) {
    return [...items];
  }

  const scored: Array<{ item: T; total: number }> = [];
  for (const item of items) {
    const fields = extractors.map((extract) => {
      const raw = extract(item);
      return raw ? normalizeArabic(raw) : '';
    });

    let total = 0;
    let everyTokenMatched = true;
    for (const token of tokens) {
      let best = 0;
      for (const field of fields) {
        best = Math.max(best, matchScore(token, field));
      }
      if (best === 0) {
        everyTokenMatched = false;
        break;
      }
      total += best;
    }

    if (everyTokenMatched) {
      scored.push({ item, total });
    }
  }

  // Array.prototype.sort is stable in every engine we ship
  // (V8/JSC), so equal scores keep their original order.
  return scored.sort((a, b) => b.total - a.total).map((s) => s.item);
}
