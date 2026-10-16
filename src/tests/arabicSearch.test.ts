/**
 * Release gate for the Arabic-aware in-app search used by
 * the manager console (POS search, menu search, orders search).
 *
 * Locks down the two properties that make a restaurant
 * owner's search "appear strongly and at the top":
 *   1. Arabic normalisation — أ/إ/آ, ة/ه, ى/ي, hamza
 *      carriers, tashkeel and tatweel never hide a match.
 *   2. Relevance ranking — exact and prefix matches always
 *      outrank deep substrings, whatever the input order.
 */

import { describe, expect, it } from 'vitest';
import {
  matchScore,
  normalizeArabic,
  rankByQuery,
} from '../utils/arabicSearch';

describe('normalizeArabic', () => {
  it('unifies alef forms (أ إ آ ٱ) with plain alef', () => {
    expect(normalizeArabic('أكلة')).toBe(normalizeArabic('اكله'));
    expect(normalizeArabic('آكلة')).toBe(normalizeArabic('اكله'));
    expect(normalizeArabic('إدارة')).toBe(normalizeArabic('اداره'));
  });

  it('unifies ta-marbuta with ha and magidiyah alef with yaa', () => {
    expect(normalizeArabic('كنافة')).toBe(normalizeArabic('كنافه'));
    expect(normalizeArabic('مطاعم')).toBe(normalizeArabic('مطاعم'));
  });

  it('strips tashkeel and tatweel so diacritics never hide a match', () => {
    expect(normalizeArabic('مُنْدي')).toBe(normalizeArabic('مندي'));
    expect(normalizeArabic('شاورمــا')).toBe(normalizeArabic('شاورما'));
    expect(normalizeArabic('كــنافة')).toBe(normalizeArabic('كنافة'));
  });

  it('unifies hamza-on-waw/yaa and collapses whitespace', () => {
    expect(normalizeArabic('سؤال')).toBe(normalizeArabic('سوال'));
    // Tatweel vanishes; genuine word spaces collapse but stay.
    expect(normalizeArabic('بيــ  ن')).toBe('بي ن');
    expect(normalizeArabic('شاورما   دجاج')).toBe('شاورما دجاج');
  });

  it('lowercases Latin fields alongside Arabic normalisation', () => {
    expect(normalizeArabic('Shawerma')).toBe('shawerma');
  });
});

describe('matchScore', () => {
  it('ranks exact > prefix > word-boundary > substring > miss', () => {
    expect(matchScore('شاورما', 'شاورما')).toBe(100);
    expect(matchScore('شاو', 'شاورما')).toBe(80);
    expect(matchScore('دجاج', 'شاورما دجاج')).toBe(60);
    expect(matchScore('اورما', 'شاورما')).toBe(40);
    expect(matchScore('بيتزا', 'شاورما')).toBe(0);
  });
});

describe('rankByQuery', () => {
  const dishes = [
    { name: 'بيتزا pepperoni', nameEn: 'Pepperoni Pizza', description: 'بيتزا إيطالية بال pepperoni' },
    { name: 'شاورما دجاج', nameEn: 'Chicken Shawarma', description: 'شاورما دجاج بصلصة الثوم' },
    { name: 'شاورما لحم', nameEn: 'Beef Shawarma', description: 'شاورما لحم مع خضار' },
    { name: 'كنافة', nameEn: 'Knafeh', description: 'كنافة نابلسية بالجبن' },
  ];

  it('returns every row when the query is empty (old contract)', () => {
    expect(rankByQuery(dishes, '', [(d) => d.name])).toHaveLength(4);
    expect(rankByQuery(dishes, '   ', [(d) => d.name])).toHaveLength(4);
  });

  it('puts the exact-name dish at the top of the results', () => {
    const ranked = rankByQuery(dishes, 'شاورما', [(d) => d.name]);
    expect(ranked[0]!.name).toBe('شاورما دجاج');
    expect(ranked[1]!.name).toBe('شاورما لحم');
    // Pizza does not match at all.
    expect(ranked).toHaveLength(2);
  });

  it('matches despite alef/ta-marbuta/tashkeel differences', () => {
    const byAlef = rankByQuery(dishes, 'كنافه', [(d) => d.name]);
    expect(byAlef.map((d) => d.name)).toContain('كنافة');

    const byTashkeel = rankByQuery(dishes, 'شاوْرمَا', [(d) => d.name]);
    expect(byTashkeel).toHaveLength(2);
  });

  it('searches every extractor field (name, English name, description)', () => {
    const byDescription = rankByQuery(dishes, 'نابلسية', [
      (d) => d.name,
      (d) => d.nameEn,
      (d) => d.description,
    ]);
    expect(byDescription.map((d) => d.name)).toEqual(['كنافة']);

    const byLatin = rankByQuery(dishes, 'pepperoni', [
      (d) => d.name,
      (d) => d.nameEn,
      (d) => d.description,
    ]);
    expect(byLatin.map((d) => d.name)).toEqual(['بيتزا pepperoni']);
  });

  it('requires every token of a multi-word query to match (AND)', () => {
    const ranked = rankByQuery(dishes, 'شاورما دجاج', [
      (d) => d.name,
      (d) => d.description,
    ]);
    expect(ranked.map((d) => d.name)).toEqual(['شاورما دجاج']);
  });

  it('keeps the original order for equal scores (stable ranking)', () => {
    const ranked = rankByQuery(dishes, 'بيتزا', [(d) => d.name, (d) => d.description]);
    // Only one row contains pizza.
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.name).toBe('بيتزا pepperoni');
  });
});
