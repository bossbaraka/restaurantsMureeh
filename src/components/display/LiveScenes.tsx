import React, { useEffect, useState } from 'react';
import type { Product } from '../../types/restaurant';
import { formatPrice } from '../../utils/formatting';
import { optimizeImageUrl } from '../customer/ProductImage';
import {
  HERO_CYCLE_MS,
  type BoardScene,
  type CategoryScene,
  type IntroScene,
  type OutroScene,
  type SpotlightScene,
} from './liveMenuModel';

/**
 * Live Menu scenes — the frames of the film.
 * ==========================================
 * Every scene is a self-contained, read-only composition. None of them owns a
 * timer except the board's hero cross-fade, which is scoped to the scene's own
 * mount and released on unmount (a scene lives for seconds, so nothing can
 * accumulate over a multi-hour loop).
 *
 * Typography is sized in `vmin`-based `clamp()`s rather than breakpoints: the
 * screen has to read from three metres on a 55" panel and still look composed
 * on a phone held in landscape for a screen recording.
 */

export interface SceneChrome {
  restaurantName: string;
  restaurantNameEn: string;
  currency: string;
}

/**
 * A dish row on a priced board. Shared with the static (phone/tablet) menu, so
 * both reads are literally the same row: a name, its note, its badges and a
 * tabular price — never a control.
 */
export const DishRow: React.FC<{
  item: Product;
  index: number;
  currency: string;
  /** Dotted leaders only when there is no image column competing for space. */
  leader?: boolean;
  /**
   * The dish's photo as a thumbnail. Used by the static menu (a hand-held
   * screen is read up close, so the photography helps identify a dish); the
   * film passes nothing and shows images in its own hero panels instead.
   */
  image?: string;
}> = ({ item, index, currency, leader = true, image }) => (
  <li
    className="display-menu__item"
    data-thumb={image ? 'true' : undefined}
    style={{ animationDelay: `calc(var(--lm-stagger) * ${index})` }}
  >
    {image && (
      <span className="display-menu__thumb" aria-hidden="true">
        <img src={optimizeImageUrl(image, 240, 66)} alt="" loading="lazy" />
      </span>
    )}
    <div className="display-menu__body">
      <div className="display-menu__name-row">
        <h3 className="display-menu__dish">{item.name}</h3>
        {item.badge && <span className="display-menu__badge">{item.badge}</span>}
        {item.isFeatured && (
          <span className="display-menu__badge display-menu__badge--gold">مميز</span>
        )}
      </div>
      {(item.nameEn || item.description) && (
        <p className="display-menu__dish-note">
          {item.nameEn ? <span className="display-menu__dish-en">{item.nameEn}</span> : null}
          {item.description ? <span className="display-menu__desc">{item.description}</span> : null}
        </p>
      )}
    </div>
    {leader && <span className="display-menu__leader" aria-hidden="true" />}
    <div className="display-menu__price">{formatPrice(item.price, currency)}</div>
  </li>
);

// ---------------------------------------------------------------------------
// Intro — the brand bumper
// ---------------------------------------------------------------------------

export const LiveIntroScene: React.FC<{
  scene: IntroScene;
  chrome: SceneChrome;
  backdrop?: string;
  logo?: string;
  tagline?: string;
  businessLabel: string;
}> = ({ chrome, backdrop, logo, tagline, businessLabel }) => {
  const monogram = (chrome.restaurantNameEn || chrome.restaurantName).trim().charAt(0) || 'م';
  return (
    <div className="display-menu__scene display-menu__scene--intro">
      {backdrop && (
        <div className="display-menu__backdrop" aria-hidden="true">
          <img src={optimizeImageUrl(backdrop, 1600, 62)} alt="" />
        </div>
      )}
      <div className="display-menu__intro-body">
        <span className="display-menu__crest" aria-hidden="true">
          {logo ? <img src={logo} alt="" /> : <span>{monogram}</span>}
        </span>
        <p className="display-menu__eyebrow">{businessLabel}</p>
        <h1 className="display-menu__name">{chrome.restaurantName}</h1>
        {chrome.restaurantNameEn && (
          <p className="display-menu__name-en">{chrome.restaurantNameEn}</p>
        )}
        {tagline && <p className="display-menu__tagline">{tagline}</p>}
        <span className="display-menu__rule" aria-hidden="true" />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Category title card
// ---------------------------------------------------------------------------

export const LiveCategoryScene: React.FC<{
  scene: CategoryScene;
  chrome: SceneChrome;
}> = ({ scene, chrome }) => (
  <div className="display-menu__scene display-menu__scene--category">
    {scene.image && (
      <div className="display-menu__backdrop display-menu__backdrop--soft" aria-hidden="true">
        <img src={optimizeImageUrl(scene.image, 1400, 60)} alt="" />
      </div>
    )}
    <div className="display-menu__category-body">
      <span className="display-menu__ordinal" aria-hidden="true">
        {scene.ordinalLabel}
      </span>
      <div className="display-menu__category-text">
        <p className="display-menu__eyebrow">
          {chrome.restaurantName}
          {scene.section.category.nameEn ? ` · ${scene.section.category.nameEn}` : ''}
        </p>
        <h2 className="display-menu__section-title">{scene.section.category.name}</h2>
        <p className="display-menu__section-sub">
          {scene.section.items.length} {scene.section.items.length === 1 ? 'طبق' : 'أطباق'}
        </p>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Spotlight — one dish, full frame
// ---------------------------------------------------------------------------

export const LiveSpotlightScene: React.FC<{
  scene: SpotlightScene;
  chrome: SceneChrome;
}> = ({ scene, chrome }) => {
  const { item, section } = scene;
  return (
    <div className="display-menu__scene display-menu__scene--spotlight">
      {item.image && (
        <div className="display-menu__backdrop" aria-hidden="true">
          <img src={optimizeImageUrl(item.image, 1800, 68)} alt="" />
        </div>
      )}
      <div className="display-menu__spotlight-body">
        <p className="display-menu__eyebrow">{section.category.name}</p>
        <h2 className="display-menu__spotlight-name">{item.name}</h2>
        {item.nameEn && <p className="display-menu__name-en">{item.nameEn}</p>}
        {item.description && <p className="display-menu__spotlight-desc">{item.description}</p>}
        <div className="display-menu__spotlight-foot">
          <span className="display-menu__price display-menu__price--hero">
            {formatPrice(item.price, chrome.currency)}
          </span>
          <span className="display-menu__spotlight-meta">
            {item.preparationTimeMinutes ? `${item.preparationTimeMinutes} دقيقة تحضير` : null}
            {item.calories ? `${item.calories} سعرة` : null}
          </span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Board — the priced list, paginated
// ---------------------------------------------------------------------------

/**
 * The image panel beside a priced page. Cross-fades through the page's own
 * photography on a single interval that dies with the scene; when the page has
 * no photography the panel is not rendered at all and the list takes the full
 * width (a type-led board, not a board with an empty box in it).
 */
const HeroPanel: React.FC<{ heroes: Product[] }> = ({ heroes }) => {
  const [active, setActive] = useState(0);
  const count = heroes.length;

  useEffect(() => {
    if (count < 2) return;
    const id = window.setInterval(() => setActive((value) => (value + 1) % count), HERO_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [count]);

  if (count === 0) return null;
  const index = active % count;
  const hero = heroes[index];
  if (!hero) return null;

  return (
    <div className="display-menu__hero" aria-hidden="true">
      {heroes.map((item, i) => (
        <img
          key={item.id}
          src={optimizeImageUrl(item.image, 1200, 66)}
          alt=""
          className="display-menu__hero-img"
          data-active={i === index ? 'true' : 'false'}
        />
      ))}
      <span className="display-menu__hero-caption">{hero.name}</span>
    </div>
  );
};

export const LiveBoardScene: React.FC<{
  scene: BoardScene;
  chrome: SceneChrome;
  leaders: boolean;
}> = ({ scene, chrome, leaders }) => {
  const { section, items, heroes, page, pageCount } = scene;
  return (
    <div className="display-menu__scene display-menu__scene--board" data-layout={heroes.length > 0 ? 'split' : 'list'}>
      <header className="display-menu__section-head">
        <div>
          <p className="display-menu__eyebrow">{chrome.restaurantName}</p>
          <h2 className="display-menu__section-title">{section.category.name}</h2>
          {section.category.nameEn && (
            <p className="display-menu__section-sub">{section.category.nameEn}</p>
          )}
        </div>
        <span className="display-menu__counter">
          {pageCount > 1 ? `صفحة ${page + 1} / ${pageCount}` : `${items.length} أطباق`}
        </span>
      </header>

      <div className="display-menu__board-grid">
        <ul className="display-menu__list">
          {items.map((item, index) => (
            <DishRow
              key={item.id}
              item={item}
              index={index}
              currency={chrome.currency}
              leader={leaders}
            />
          ))}
        </ul>
        <HeroPanel heroes={heroes} />
      </div>

      <p className="display-menu__note">
        الأسعار تشمل ضريبة القيمة المضافة · للطلب يرجى التوجه إلى الكاشير
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Outro — loop back to the brand
// ---------------------------------------------------------------------------

export const LiveOutroScene: React.FC<{
  scene: OutroScene;
  chrome: SceneChrome;
  backdrop?: string;
  logo?: string;
  displayUrl: string;
  canReserve: boolean;
}> = ({ chrome, backdrop, logo, displayUrl, canReserve }) => {
  const monogram = (chrome.restaurantNameEn || chrome.restaurantName).trim().charAt(0) || 'م';
  return (
    <div className="display-menu__scene display-menu__scene--outro">
      {backdrop && (
        <div className="display-menu__backdrop display-menu__backdrop--soft" aria-hidden="true">
          <img src={optimizeImageUrl(backdrop, 1400, 60)} alt="" />
        </div>
      )}
      <div className="display-menu__outro-body">
        <span className="display-menu__crest" aria-hidden="true">
          {logo ? <img src={logo} alt="" /> : <span>{monogram}</span>}
        </span>
        <h2 className="display-menu__name">{chrome.restaurantName}</h2>
        <p className="display-menu__outro-line">
          {canReserve ? 'اسأل موظفينا عن حجز طاولتك' : 'نتمنى لك وجبة سعيدة'}
        </p>
        {displayUrl && (
          <span className="display-menu__url">{displayUrl.replace(/^https?:\/\//, '')}</span>
        )}
      </div>
    </div>
  );
};



