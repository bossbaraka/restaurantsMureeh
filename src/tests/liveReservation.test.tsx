import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * «احجز طاولتك» — the single interaction the Live Menu offers.
 *
 * Two guarantees are asserted here:
 *   1. the CTA exists ONLY when the venue published a WhatsApp number (an
 *      empty channel must never produce a dead button on a wall screen);
 *   2. the copy never claims the table is booked — the platform has no
 *      reservation engine, the VENUE confirms.
 */

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      products: [],
      categories: [],
      currentRestaurant: null,
      showToast: () => {},
    }),
  };
});

const { LiveReserveCta, LiveReservationPanel } = await import(
  '../components/display/LiveReservation'
);

const render = (ui: React.ReactElement) => renderToStaticMarkup(ui);

describe('LiveReserveCta', () => {
  it('renders the single call to action with an accessible name', () => {
    const html = render(
      <LiveReserveCta
        restaurantName="مطعم الديوان"
        whatsappNumber="970599123456"
        onOpen={() => {}}
      />
    );

    expect(html).toContain('احجز طاولتك');
    expect(html).toContain('aria-label="احجز طاولتك في مطعم الديوان"');
    expect(html).toContain('display-menu__cta');
    // It is the ONLY action on the screen: no ordering, no social, no contact.
    for (const forbidden of ['اطلب الآن', 'السلة', 'إنستغرام', 'فيسبوك', 'تواصل معنا']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('disappears while another overlay owns the screen', () => {
    expect(
      render(
        <LiveReserveCta
          restaurantName="مطعم الديوان"
          whatsappNumber="970599123456"
          onOpen={() => {}}
          hidden
        />
      )
    ).toBe('');
  });
});

describe('LiveReservationPanel', () => {
  const props = {
    isOpen: true,
    restaurantName: 'مطعم الديوان',
    whatsappNumber: '970599123456',
    onClose: () => {},
  };

  it('renders nothing when closed, and nothing without a usable number', () => {
    expect(render(<LiveReservationPanel {...props} isOpen={false} />)).toBe('');
    expect(render(<LiveReservationPanel {...props} whatsappNumber="" />)).toBe('');
    expect(render(<LiveReservationPanel {...props} whatsappNumber="abc" />)).toBe('');
  });

  it('asks for the four things a table request needs, plus an optional note', () => {
    const html = render(<LiveReservationPanel {...props} />);

    expect(html).toContain('id="live-reserve-name"');
    expect(html).toContain('id="live-reserve-party"');
    expect(html).toContain('id="live-reserve-date"');
    expect(html).toContain('id="live-reserve-time"');
    expect(html).toContain('id="live-reserve-notes"');
    expect(html).toContain('اختياري');
    // Accessible by dialog semantics, not by colour or position.
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('says the venue confirms, and never that the booking is done', () => {
    const html = render(<LiveReservationPanel {...props} />);

    expect(html).toContain('احجز طاولتك');
    expect(html).toContain('واتساب المطعم');
    expect(html).toContain('التأكيد من إدارة المطعم');
    expect(html).not.toContain('تم تأكيد الحجز');
    expect(html).not.toContain('تم الحجز بنجاح');
  });

  it('submits through WhatsApp, not through an endpoint that does not exist', () => {
    const html = render(<LiveReservationPanel {...props} />);

    expect(html).toContain('إرسال الطلب عبر واتساب');
    // A <form> with no action: the submit handler builds the wa.me link.
    expect(html).not.toContain('action="/api');
  });

  it('blocks a date in the past at the input level', () => {
    const html = render(<LiveReservationPanel {...props} />);
    expect(html).toMatch(/min="\d{4}-\d{2}-\d{2}"/);
  });
});

describe('Live Menu reservation wiring', () => {
  it('is the only interactive element the board adds for a venue with WhatsApp', async () => {
    // The board itself stays read-only; the CTA is the sole addition.
    const { DisplayMenu } = await import('../components/customer/DisplayMenu');
    const html = render(<DisplayMenu />);

    // No WhatsApp on the mocked tenant in displayMenu.test → no CTA there.
    expect(html).not.toContain('display-menu__cta');
    // ...and no ordering affordance anywhere on the screen.
    expect(html).not.toContain('إضافة');
    expect(html).not.toContain('cart');
  });
});
