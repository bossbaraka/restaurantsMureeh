/**
 * Landing page — crawlable content contract.
 *
 * The homepage is a client-rendered SPA; what a search engine ultimately
 * indexes is the DOM React produces. This test renders the REAL landing
 * component to static HTML (no effects, no browser APIs — the same output a
 * renderer gets before any interaction) and asserts on the text and link
 * structure that matters for discovery and understanding:
 *
 *   - exactly one <h1>, and the "what is Mureeh" definition block with its
 *     own <h2> and three question-style <h3>s;
 *   - the service is named in plain words (digital / QR menu for
 *     restaurants and cafés), not only in taglines;
 *   - crawlable <a href> links to the public directory and to every ACTIVE
 *     venue the public API reports (no JS-only navigation);
 *   - the FAQ answers are rendered as text (the FAQPage JSON-LD mirrors them).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const tenantsList = [
  { id: 'r1', slug: 'ghosn-cafe', name: 'غصن كافيه', nameEn: 'Ghosn Cafe', status: 'ACTIVE', businessType: 'CAFE', logo: '' },
  { id: 'r2', slug: 'bayt-al-sham', name: 'بيت الشام', nameEn: 'Bayt Al Sham', status: 'ACTIVE', businessType: 'RESTAURANT', logo: 'https://cdn.example.com/logo.png' },
  { id: 'r3', slug: 'closed-venue', name: 'مغلق', nameEn: 'Closed', status: 'SUSPENDED', businessType: 'RESTAURANT', logo: '' },
];

vi.mock('../context/RestaurantContext', () => ({
  useRestaurant: () => ({ setViewMode: vi.fn(), tenantsList }),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, isSuperAdmin: false, setIsLoginModalOpen: vi.fn() }),
}));
// The demo video player touches media/observer APIs; it is not part of the
// crawlable-content contract.
vi.mock('../components/common/landing/DemoVideoPlayer', () => ({
  DemoVideoPlayer: () => <div data-slot="demo-video" />,
}));

const { SaaSLandingPage } = await import('../components/common/SaaSLandingPage');

const html = renderToStaticMarkup(<SaaSLandingPage />);
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('landing page — crawlable content', () => {
  it('has exactly one <h1> and a semantic heading outline for the definition block', () => {
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).toMatch(/<section id="about" aria-labelledby="about-title"/);
    expect(html).toMatch(/<h2 id="about-title"[^>]*>منصة منيو إلكتروني QR للمطاعم والكافيهات<\/h2>/);
    const about = html.slice(html.indexOf('<section id="about"'), html.indexOf('<section id="how"'));
    const h3s = Array.from(about.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g), (m) => m[1]);
    expect(h3s).toEqual(['لمن صُمّم مُريح؟', 'ما المشكلة التي يحلّها؟', 'كيف يعمل المنيو الرقمي؟']);
    // No heading-level skip inside the block (h2 → h3 only).
    expect(about).not.toMatch(/<h[14-6]\b/);
  });

  it('names the service in plain words, including the English product name', () => {
    expect(text).toContain('منيو إلكتروني');
    expect(text).toContain('رمز QR');
    expect(text).toContain('(Mureeh Menu)');
    expect(text).toContain('للمطاعم والكافيهات والمخابز');
  });

  it('links to the public directory and to every ACTIVE venue with plain anchors (not JS-only navigation)', () => {
    expect(html).toContain('href="/restaurants"');
    expect(html).toContain('href="/r/ghosn-cafe"');
    expect(html).toContain('href="/r/bayt-al-sham"');
    // Non-ACTIVE venues are never advertised.
    expect(html).not.toContain('/r/closed-venue');
    // Descriptive, non-generic anchor text accompanies the venue links.
    expect(text).toContain('عرض المنيو');
    expect(text).toContain('تصفح منيوهات مطاعم حقيقية على مُريح');
  });

  it('renders the FAQ answers as visible text (the FAQPage JSON-LD must have something to mirror)', () => {
    expect(text).toContain('هل يمكنني تغيير باقتي لاحقاً؟');
    expect(text).toContain('هل أحتاج لشراء أجهزة أو معدات خاصة؟');
  });

  it('never prints placeholder or undefined values', () => {
    expect(text).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/);
  });
});
