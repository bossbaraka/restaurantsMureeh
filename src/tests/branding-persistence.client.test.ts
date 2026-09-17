/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

// Frontend half of the branding persistence regression: the API client
// refuses to run outside a browser window, so this file runs under jsdom.
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

// ===========================================================================
// 5. Frontend createTableSession mapping
// ===========================================================================
describe('api.createTableSession preserves the theme', () => {
  it('maps coverImage/primaryColor/accentColor/logoFit/logoPosition (no default reset)', async () => {
    const { api } = await import('../services/api');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          statusCode: 200,
          data: {
            sessionToken: 'sess',
            sessionId: 'session-1',
            tableId: 'table-1',
            tableNumber: 7,
            restaurant: {
              id: TENANT_ID,
              name: 'غصن',
              nameEn: 'Ghosn',
              slug: 'ghosn',
              logo: 'https://project.supabase.co/storage/v1/object/public/restaurant-assets/r/logo.png',
              coverImage: 'https://project.supabase.co/storage/v1/object/public/restaurant-assets/r/cover.jpg',
              logoFit: 'contain',
              logoPosition: '20% 80%',
              primaryColor: '#123456',
              accentColor: '#654321',
              businessType: 'CAFE',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    try {
      const res = await api.createTableSession('qr-token-abc');
      expect(res.success).toBe(true);
      const r = res.data!.restaurant;
      expect(r.primaryColor).toBe('#123456');
      expect(r.accentColor).toBe('#654321');
      expect(r.logoFit).toBe('contain');
      expect(r.logoPosition).toBe('20% 80%');
      expect(r.coverImage).toContain('/restaurant-assets/r/cover.jpg');
      expect(r.logo).toContain('/restaurant-assets/r/logo.png');
      expect(r.businessType).toBe('CAFE');
      // Never the platform defaults when the server sent real values.
      expect(r.primaryColor).not.toBe('#D4AF37');
      expect(r.accentColor).not.toBe('#C5A880');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

