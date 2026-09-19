import React from 'react';
import { ArrowUpLeft } from 'lucide-react';
import { useRestaurant } from '../../context/RestaurantContext';
import { collectRestaurantSocials } from '../../utils/socialLinks';
import { buildWhatsappUrl, normalizeWhatsappNumber } from '../../utils/whatsapp';
import {
  FacebookMark,
  InstagramMark,
  TiktokMark,
  WebsiteMark,
  WhatsappMark,
  YoutubeMark,
} from '../common/SocialMarks';

/**
 * «تواصل معنا» — the venue's own channels, inside the guest menu.
 * ==============================================================
 * Lives in the CUSTOMER menu only. The Live Menu screen deliberately has no
 * social row: it has exactly one call to action («احجز طاولتك»).
 *
 * Everything here is venue-supplied and optional. The section renders NOTHING
 * when the restaurant published no channel — no heading, no empty icons, no
 * placeholder tiles. With one channel it is a single wide tile; with five it
 * wraps into a tidy row, because the layout is an auto-fit grid rather than a
 * fixed 3-column footer strip.
 *
 * Links are validated client-side (HTTPS + per-platform host allowlist) before
 * they become an `href`, and every anchor carries `rel="noopener noreferrer"`,
 * an explicit `aria-label` and a visible name — the icon alone is never the
 * only way to tell what a tile does.
 */
/** Which mark belongs to which published channel. */
const SOCIAL_MARKS: Record<string, React.ComponentType<{ className?: string }>> = {
  instagram: InstagramMark,
  facebook: FacebookMark,
  tiktok: TiktokMark,
  youtube: YoutubeMark,
  website: WebsiteMark,
};

export const CustomerSocialSection: React.FC = () => {
  const { currentRestaurant } = useRestaurant();

  const links = collectRestaurantSocials(currentRestaurant);
  const whatsapp = normalizeWhatsappNumber(currentRestaurant?.whatsappNumber);
  const whatsappUrl = whatsapp
    ? buildWhatsappUrl(
        whatsapp,
        `السلام عليكم، أتواصل معكم عبر قائمة الطعام في ${currentRestaurant?.name || 'المطعم'}.`
      )
    : null;

  // No channel published → no section at all.
  if (links.length === 0 && !whatsappUrl) return null;

  const restaurantName = currentRestaurant?.name || 'المطعم';
  const single = links.length + (whatsappUrl ? 1 : 0) === 1;

  return (
    <section
      className="customer-social mt-10 rounded-3xl border border-luxury-800 bg-luxury-900/70 p-5 sm:p-6"
      aria-labelledby="customer-social-title"
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3
            id="customer-social-title"
            className="font-serif text-base sm:text-lg font-bold text-luxury-50"
          >
            تابعنا
          </h3>
          <p className="text-[11px] text-luxury-400 mt-0.5">
            قنوات {restaurantName} الرسمية — تابع جديدنا وعروضنا أولاً بأول.
          </p>
        </div>
        <span
          className="h-px flex-1 min-w-[3rem] opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(to left, rgb(var(--brand-primary-strong-rgb) / 0.55), transparent)',
          }}
          aria-hidden="true"
        />
      </header>

      <ul
        className={`grid gap-2.5 ${
          single ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
        }`}
      >
        {whatsappUrl && (
          <li className={single ? 'col-span-1' : 'col-span-2 sm:col-span-1'}>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`مراسلة ${restaurantName} على واتساب`}
              className="group flex h-full items-center gap-3 rounded-2xl border border-luxury-700/70 bg-luxury-950/70 p-3 transition-colors hover:border-[rgb(var(--brand-primary-strong-rgb)/0.6)]"
            >
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-luxury-950"
                style={{ backgroundImage: 'var(--brand-fill)' }}
                aria-hidden="true"
              >
                <WhatsappMark className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-luxury-100">واتساب</span>
                <span className="block truncate text-[11px] text-luxury-400 direction-ltr" dir="ltr">
                  +{whatsapp}
                </span>
              </span>
              <ArrowUpLeft
                className="ms-auto h-3.5 w-3.5 shrink-0 text-luxury-600 transition-colors group-hover:text-[var(--brand-primary-strong)]"
                aria-hidden="true"
              />
            </a>
          </li>
        )}

        {links.map((link) => {
          const Mark = SOCIAL_MARKS[link.id];
          return (
            <li key={link.id} className={single ? 'col-span-1' : undefined}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.labelEn}
                aria-label={`${link.label} — ${restaurantName}`}
                className="group flex h-full items-center gap-3 rounded-2xl border border-luxury-800 bg-luxury-950/50 p-3 transition-colors hover:border-[rgb(var(--brand-primary-strong-rgb)/0.6)]"
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-luxury-700/70 bg-luxury-900 text-[var(--brand-primary-strong)]"
                  aria-hidden="true"
                >
                  <Mark className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-luxury-100">{link.label}</span>
                  {link.handle && (
                    <span
                      className="block truncate text-[11px] text-luxury-400"
                      dir={link.handle.startsWith('@') ? 'ltr' : undefined}
                    >
                      {link.handle}
                    </span>
                  )}
                </span>
                <ArrowUpLeft
                  className="ms-auto h-3.5 w-3.5 shrink-0 text-luxury-600 transition-colors group-hover:text-[var(--brand-primary-strong)]"
                  aria-hidden="true"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default CustomerSocialSection;
