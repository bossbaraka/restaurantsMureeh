import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeThemeConfigs, DEFAULT_PLATFORM_CONFIG, FALLBACK_THEME, type ThemeConfig } from '../../server/services/themeResolver';

// Mock storage and config before importing resolver
vi.mock('../../server/config', () => ({
  config: { appUrl: 'http://localhost:3000' }
}));

vi.mock('../../server/services/storage', () => ({
  getStorage: () => ({
    getUrl: (key: string) => `http://cdn/${key}`,
    keyFromUrl: () => null,
    exists: async () => true,
  }),
  assetUrlResolverFor: () => (key: string) => `http://cdn/${key}`,
  assetNormalizerFor: () => ({ keyFromUrl: () => null }),
  keyBelongsToRestaurant: () => true,
  isStorageKey: (k: string) => k.startsWith('restaurants/'),
}));

const mockFindFirst = vi.fn();
const mockRestaurantFindFirst = vi.fn();
const mockBranchFindFirst = vi.fn();

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    theme: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
    },
    restaurant: {
      findFirst: (...args: any[]) => mockRestaurantFindFirst(...args),
    },
    branch: {
      findFirst: (...args: any[]) => mockBranchFindFirst(...args),
    },
  },
}));

const { resolveEffectiveTheme } = await import('../../server/services/themeResolver');

beforeEach(() => {
  mockFindFirst.mockReset();
  mockRestaurantFindFirst.mockReset();
  mockBranchFindFirst.mockReset();
  // Default: no theme rows, legacy colors exist
  mockFindFirst.mockImplementation(async ({ where }: any) => {
    // platform default null => use DEFAULT_PLATFORM_CONFIG
    return null;
  });
  mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });
  mockBranchFindFirst.mockResolvedValue({ id: 'branch-1' });
});

describe('backward compatibility — legacy primary/accent as fallback layer', () => {
  it('1. Restaurant بدون Theme + ألوان legacy مخصصة → Platform + legacy', async () => {
    mockFindFirst.mockResolvedValue(null); // no platform, no restaurant, no branch theme
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });

    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: null });

    expect(effective.colors.primary).toBe('#FF0000');
    expect(effective.colors.accent).toBe('#00FF00');
    expect(effective.colors.secondary).toBe('#00FF00');
    // source remains fallback/platform because no Theme row
    expect(['fallback', 'platform', 'restaurant']).toContain(effective.source);
  });

  it('2. Restaurant لديه Theme كامل → يتغلب على legacy', async () => {
    mockFindFirst.mockImplementation(async ({ where }: any) => {
      if (where.restaurantId === null && where.branchId === null) return null; // platform none
      if (where.restaurantId === 'rest-1' && where.branchId === null) {
        return { config: { colors: { primary: '#123456', accent: '#654321', secondary: '#654321' } } };
      }
      return null;
    });
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });

    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: null });

    // Restaurant Theme overrides legacy
    expect(effective.colors.primary).toBe('#123456');
    expect(effective.colors.accent).toBe('#654321');
    expect(effective.source).toBe('restaurant');
  });

  it('3. Branch لديه Theme → يطبق', async () => {
    mockFindFirst.mockImplementation(async ({ where }: any) => {
      if (where.branchId === 'branch-1') {
        return { config: { colors: { primary: '#0000FF' } } };
      }
      if (where.restaurantId === 'rest-1' && where.branchId === null) {
        return { config: { colors: { primary: '#123456' } } };
      }
      return null;
    });
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });

    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: 'branch-1' });

    expect(effective.colors.primary).toBe('#0000FF');
    expect(effective.source).toBe('branch');
  });

  it('4. Branch Theme جزئي يندمج مع Restaurant/Platform/Legacy', async () => {
    mockFindFirst.mockImplementation(async ({ where }: any) => {
      if (where.branchId === 'branch-1') {
        return { config: { colors: { primary: '#0000FF' }, radius: { lg: '30px' } } };
      }
      if (where.restaurantId === 'rest-1' && where.branchId === null) {
        return { config: { colors: { secondary: '#111111' } } };
      }
      return null;
    });
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });

    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: 'branch-1' });

    // Branch primary overrides, restaurant secondary preserved, legacy accent preserved if not overridden
    expect(effective.colors.primary).toBe('#0000FF'); // from branch
    expect(effective.colors.secondary).toBe('#111111'); // from restaurant theme
    // accent from legacy since neither restaurant nor branch theme sets it in this mock (restaurant theme only secondary)
    // Actually restaurant theme in this case does NOT set accent, so legacy accent should survive
    expect(effective.colors.accent).toBe('#00FF00');
    expect(effective.radius.lg).toBe('30px');
  });

  it('5. Reset Restaurant Theme → يعود إلى legacy + Platform', async () => {
    // Simulate after DELETE: no restaurant theme row
    mockFindFirst.mockResolvedValue(null);
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#AA0000', accentColor: '#00AA00' });

    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: null });

    expect(effective.colors.primary).toBe('#AA0000');
    expect(effective.colors.accent).toBe('#00AA00');
    // Other values from platform fallback
    expect(effective.background).toBeDefined();
  });

  it('6. Reset Branch Theme → يعود إلى Restaurant/legacy+Platform وليس FALLBACK مباشرة', async () => {
    mockFindFirst.mockImplementation(async ({ where }: any) => {
      if (where.restaurantId === 'rest-1' && where.branchId === null) {
        return { config: { colors: { primary: '#123456' } } };
      }
      // branch theme deleted → null
      return null;
    });
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });
    mockBranchFindFirst.mockResolvedValue(null); // branch not valid? Actually we want valid branch but no theme

    // To test reset, we call without branchId? No, reset branch means branchId still supplied but no branch theme row
    // So branchCheck must be valid, but branchRow null
    mockBranchFindFirst.mockResolvedValue({ id: 'branch-1' });

    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: 'branch-1' });

    // Should return restaurant theme primary, not fallback #D4AF37
    expect(effective.colors.primary).toBe('#123456');
    expect(effective.source).not.toBe('fallback'); // should be restaurant or platform, not direct fallback when restaurant exists
  });

  it('6b. Reset Branch Theme عندما لا يوجد Restaurant Theme → يعود إلى legacy+Platform', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });
    mockBranchFindFirst.mockResolvedValue({ id: 'branch-1' });

    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: 'branch-1' });

    expect(effective.colors.primary).toBe('#FF0000');
    expect(effective.colors.accent).toBe('#00FF00');
  });

  it('merge order: FALLBACK → Platform → Legacy → Restaurant → Branch', () => {
    const platform: ThemeConfig = { colors: { primary: '#111111', accent: '#111111', secondary: '#111111' } as any };
    const legacy: ThemeConfig = { colors: { primary: '#FF0000', accent: '#00FF00', secondary: '#00FF00' } as any };
    const restaurant: ThemeConfig = { colors: { primary: '#123456' } as any };
    const branch: ThemeConfig = { colors: { primary: '#0000FF' } as any };

    let merged = mergeThemeConfigs(DEFAULT_PLATFORM_CONFIG, platform);
    merged = mergeThemeConfigs(merged, legacy);
    merged = mergeThemeConfigs(merged, restaurant);
    merged = mergeThemeConfigs(merged, branch);

    expect(merged.colors?.primary).toBe('#0000FF'); // branch wins
    // Now without branch
    let merged2 = mergeThemeConfigs(DEFAULT_PLATFORM_CONFIG, platform);
    merged2 = mergeThemeConfigs(merged2, legacy);
    merged2 = mergeThemeConfigs(merged2, restaurant);
    expect(merged2.colors?.primary).toBe('#123456'); // restaurant overrides legacy
    expect(merged2.colors?.accent).toBe('#00FF00'); // legacy preserved when restaurant doesn't override accent

    // Only platform + legacy
    let merged3 = mergeThemeConfigs(DEFAULT_PLATFORM_CONFIG, platform);
    merged3 = mergeThemeConfigs(merged3, legacy);
    expect(merged3.colors?.primary).toBe('#FF0000');
    expect(merged3.colors?.accent).toBe('#00FF00');
  });

  it('لا ينشئ Theme row أثناء resolve (read-only)', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockRestaurantFindFirst.mockResolvedValue({ primaryColor: '#FF0000', accentColor: '#00FF00' });
    // Count calls: only findFirst, no create/update
    const effective = await resolveEffectiveTheme({ restaurantId: 'rest-1', branchId: null });
    expect(mockFindFirst).toHaveBeenCalled();
    expect(mockRestaurantFindFirst).toHaveBeenCalled();
    expect(effective.colors.primary).toBe('#FF0000');
  });
});
