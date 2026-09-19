import { describe, expect, it } from 'vitest';
import type { Category, Product, Restaurant } from '../types/restaurant';
import {
  BOARD_MAX_MS,
  buildLiveScenes,
  buildLiveSections,
  imageCoverage,
  ordinalLabel,
  resolveLiveProfile,
  SCENE_BASE_MS,
} from '../components/display/liveMenuModel';

/**
 * The Live Menu model is pure data, so the guarantees that matter for a screen
 * running unattended are asserted here rather than through the DOM:
 *   - the loop is well-formed (no empty beats, every dish reachable);
 *   - the visual language is DERIVED from the venue, never fixed.
 */

const restaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
  id: 'r1',
  name: 'مطعم',
  nameEn: 'Venue',
  slug: 'venue',
  logo: '',
  description: '',
  phone: '',
  address: '',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Jerusalem',
  status: 'ACTIVE',
  primaryColor: '#D4AF37',
  accentColor: '#C5A880',
  planId: 'plan-pro',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const category = (id: string, name: string, sortOrder: number): Category => ({
  id,
  restaurantId: 'r1',
  name,
  nameEn: name.toUpperCase(),
  sortOrder,
});

const product = (id: string, categoryId: string, overrides: Partial<Product> = {}): Product => ({
  id,
  restaurantId: 'r1',
  categoryId,
  name: `طبق ${id}`,
  nameEn: `Dish ${id}`,
  description: 'وصف الطبق',
  price: 30,
  image: '',
  isAvailable: true,
  ...overrides,
});

const categories = [category('c1', 'المقبلات', 1), category('c2', 'الأطباق الرئيسية', 2)];

describe('buildLiveSections', () => {
  it('drops unavailable dishes and sections left with nothing to show', () => {
    const sections = buildLiveSections(
      [...categories, category('c3', 'فارغ', 3)],
      [product('p1', 'c1'), product('p2', 'c2', { isAvailable: false })]
    );

    expect(sections.map((section) => section.category.id)).toEqual(['c1']);
    expect(sections[0].items.map((item) => item.id)).toEqual(['p1']);
  });

  it('computes the photography ratio the visual profile reads', () => {
    const sections = buildLiveSections(categories, [
      product('p1', 'c1', { image: 'https://example.test/a.jpg' }),
      product('p2', 'c1'),
    ]);
    expect(imageCoverage(sections)).toBe(0.5);
    expect(imageCoverage([])).toBe(0);
  });
});

describe('buildLiveScenes', () => {
  const sections = buildLiveSections(categories, [
    product('p1', 'c1', { image: 'https://example.test/a.jpg', isFeatured: true }),
    product('p2', 'c1'),
    product('p3', 'c2'),
  ]);
  const profile = resolveLiveProfile(restaurant(), sections);
  const scenes = buildLiveScenes(sections, { profile });

  it('plays a brand bumper, then a card / spotlight / board beat per section, then closes', () => {
    expect(scenes[0].kind).toBe('intro');
    expect(scenes.at(-1).kind).toBe('outro');
    expect(scenes.map((scene) => scene.kind)).toEqual([
      'intro',
      'category',
      'spotlight',
      'board',
      'category',
      'board',
      'outro',
    ]);
  });

  it('gives every scene a positive dwell and a category ordinal', () => {
    for (const scene of scenes) {
      expect(scene.durationMs).toBeGreaterThan(1000);
      expect(scene.ordinal).toBeGreaterThanOrEqual(1);
      expect(scene.id).toBeTruthy();
    }
  });

  it('skips the spotlight beat when a section has no photography', () => {
    // Section 2 has no images at all: no fake image moment is invented.
    const second = scenes.filter((scene) => scene.sectionIndex === 1);
    expect(second.map((scene) => scene.kind)).toEqual(['category', 'board']);
  });

  it('paginates a long section so every dish reaches the screen', () => {
    const many = buildLiveSections(
      [category('c1', 'المقبلات', 1)],
      Array.from({ length: 23 }, (_, i) => product(`p${i}`, 'c1'))
    );
    const manyProfile = resolveLiveProfile(restaurant(), many);
    const boards = buildLiveScenes(many, { profile: manyProfile }).filter(
      (scene) => scene.kind === 'board'
    );

    const shown = boards.flatMap((scene) =>
      scene.kind === 'board' ? scene.items.map((item) => item.id) : []
    );
    expect(shown).toHaveLength(23);
    expect(new Set(shown).size).toBe(23);
    expect(boards.length).toBeGreaterThan(1);
    // A board never overruns the ceiling, however long the section is.
    for (const board of boards) expect(board.durationMs).toBeLessThanOrEqual(BOARD_MAX_MS);
  });

  it('returns no scenes for an empty menu instead of an empty loop', () => {
    expect(buildLiveScenes([], { profile })).toEqual([]);
  });

  it('labels ordinals as two digits for the big category number', () => {
    expect(ordinalLabel(1)).toBe('01');
    expect(ordinalLabel(12)).toBe('12');
  });
});

describe('resolveLiveProfile — the screen is derived from the venue', () => {
  const shot = (count: number, withImage: boolean) =>
    buildLiveSections(
      [category('c1', 'القسم', 1)],
      Array.from({ length: count }, (_, i) =>
        product(`p${i}`, 'c1', withImage ? { image: 'https://example.test/x.jpg' } : {})
      )
    );

  it('gives a saturated brand a bolder, tighter screen than a desaturated one', () => {
    const vivid = resolveLiveProfile(restaurant({ primaryColor: '#E01B24' }), shot(6, true));
    const muted = resolveLiveProfile(restaurant({ primaryColor: '#6E6A5E' }), shot(6, true));

    expect(vivid.displayFace).toBe('sans');
    expect(muted.displayFace).toBe('serif');
    expect(Number(vivid.vars['--lm-title-weight'])).toBeGreaterThan(
      Number(muted.vars['--lm-title-weight'])
    );
    expect(parseInt(vivid.vars['--lm-radius'], 10)).toBeGreaterThan(
      parseInt(muted.vars['--lm-radius'], 10)
    );
    // Different brands → different canvases (never one fixed template colour).
    expect(vivid.vars['--lm-bg-0']).not.toBe(muted.vars['--lm-bg-0']);
  });

  it('switches to type-led boards when the venue has no photography', () => {
    const withImages = resolveLiveProfile(restaurant(), shot(6, true));
    const withoutImages = resolveLiveProfile(restaurant(), shot(6, false));

    expect(withImages.layout).toBe('image-led');
    expect(withoutImages.layout).toBe('type-led');
    // A type-led board fits more rows, because there is no image column.
    expect(withoutImages.perPage).toBeGreaterThan(withImages.perPage);
  });

  it('paces a café more slowly than a bakery from the same catalog', () => {
    const sections = shot(5, true);
    const cafe = resolveLiveProfile(restaurant({ businessType: 'CAFE' }), sections);
    const bakery = resolveLiveProfile(restaurant({ businessType: 'BAKERY' }), sections);

    expect(cafe.rhythm).toBeGreaterThan(bakery.rhythm);
    expect(
      buildLiveScenes(sections, { profile: cafe })[0].durationMs
    ).toBeGreaterThan(buildLiveScenes(sections, { profile: bakery })[0].durationMs);
  });

  it('keeps every timing inside sane signage bounds', () => {
    const sections = shot(8, true);
    const profile = resolveLiveProfile(restaurant(), sections);
    expect(profile.rhythm).toBeGreaterThanOrEqual(0.85);
    expect(profile.rhythm).toBeLessThanOrEqual(1.25);
    expect(SCENE_BASE_MS.intro).toBeGreaterThan(SCENE_BASE_MS.category);
  });

  it('survives a tenant with no colours, no images and no kind', () => {
    const profile = resolveLiveProfile(null, []);
    expect(profile.vars['--lm-brand']).toBeTruthy();
    expect(profile.perPage).toBeGreaterThan(0);
    expect(profile.rationale.length).toBeGreaterThan(0);
  });
});
