import React from 'react';
import { MonitorPlay } from 'lucide-react';
import type { LiveSection } from './liveMenuModel';
import { DishRow, type SceneChrome } from './LiveScenes';

/**
 * The static Live Menu — what a phone or a tablet sees.
 * =====================================================
 * The automatic film is composed for a TV: it advances on its own, uses
 * scene-sized type and assumes a viewer standing three metres away. On a
 * hand-held screen the same content is instead laid out as ONE still, scrolling
 * page — every section, every available dish, at the guest's own pace.
 *
 * It is read-only by construction, exactly like the film: no cart, no
 * add-to-cart, no quantity, no ordering affordance (see the note on each
 * section, which is the same instruction the boards carry). The rows are the
 * SAME `DishRow` the film renders, so the two reads can never drift apart.
 */
export const LiveStaticMenu: React.FC<{
  chrome: SceneChrome;
  sections: LiveSection[];
  logo?: string;
  tagline?: string;
  /** Where the board is published, printed in the footer. */
  displayUrl?: string;
}> = ({ chrome, sections, logo, tagline, displayUrl }) => {
  const dishCount = sections.reduce((total, section) => total + section.items.length, 0);
  return (
    <div className="display-menu__static" data-testid="display-menu-static">
      {/* The venue is always on screen — same chrome as the film. */}
      <header className="display-menu__header display-menu__header--static">
        <div className="display-menu__brand">
          <span className="display-menu__crest display-menu__crest--chrome" aria-hidden="true">
            {logo ? <img src={logo} alt="" /> : <MonitorPlay className="display-menu__crest-icon" />}
          </span>
          <div className="display-menu__titles">
            <h1 className="display-menu__name display-menu__name--chrome">{chrome.restaurantName}</h1>
            {(chrome.restaurantNameEn || tagline) && (
              <p className="display-menu__tagline">
                {chrome.restaurantNameEn}
                {chrome.restaurantNameEn && tagline ? ' · ' : ''}
                {tagline || ''}
              </p>
            )}
          </div>
        </div>
        <div className="display-menu__meta">
          <span className="display-menu__chip">
            <MonitorPlay className="display-menu__chip-icon" />
            عرض القائمة
          </span>
        </div>
      </header>

      {sections.length === 0 ? (
        <div className="display-menu__empty">
          <h2 className="display-menu__section-title">القائمة قيد التحديث</h2>
          <p>لا توجد أطباق متاحة للعرض حالياً.</p>
        </div>
      ) : (
        <div className="display-menu__static-body">
          {sections.map((section) => (
            <section key={section.category.id} className="display-menu__static-section">
              <header className="display-menu__section-head">
                <div>
                  <p className="display-menu__eyebrow">{chrome.restaurantName}</p>
                  <h2 className="display-menu__section-title">{section.category.name}</h2>
                  {section.category.nameEn && (
                    <p className="display-menu__section-sub">{section.category.nameEn}</p>
                  )}
                </div>
                <span className="display-menu__counter">{section.items.length} أطباق</span>
              </header>

              <ul className="display-menu__list">
                {section.items.map((item, index) => (
                  <DishRow
                    key={item.id}
                    item={item}
                    index={index}
                    currency={chrome.currency}
                    leader={false}
                    image={item.image || undefined}
                  />
                ))}
              </ul>

              <p className="display-menu__note">
                الأسعار تشمل ضريبة القيمة المضافة · للطلب يرجى التوجه إلى الكاشير
              </p>
            </section>
          ))}
          <p className="display-menu__note display-menu__note--static">
            {dishCount} طبقاً على القائمة · شاشة عرض للقراءة فقط — لا يمكن تنفيذ أي طلب من خلالها
          </p>
        </div>
      )}

      <footer className="display-menu__foot">
        <span>{chrome.restaurantName}</span>
        <span className="display-menu__dot-sep" aria-hidden="true">
          ·
        </span>
        <span>
          مُدار بواسطة <strong>منصة مريح MUREEH</strong>
        </span>
        {displayUrl && (
          <span className="display-menu__url">{displayUrl.replace(/^https?:\/\//, '')}</span>
        )}
      </footer>
    </div>
  );
};

export default LiveStaticMenu;
