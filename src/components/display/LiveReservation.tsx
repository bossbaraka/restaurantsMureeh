import React, { useCallback, useMemo, useState } from 'react';
import { Armchair, CalendarDays, Check, Clock3, Minus, Plus, Send, Users, X } from 'lucide-react';
import { dialogProps, useDialog } from '../../hooks/useDialog';
import {
  buildReservationMessage,
  buildWhatsappUrl,
  normalizeWhatsappNumber,
} from '../../utils/whatsapp';

/**
 * «احجز طاولتك» — the ONE interaction the Live Menu offers.
 * =========================================================
 * The screen is read-only: no cart, no quantities, no ordering. A guest may
 * only ask for a table, and the platform has no reservation engine — so this
 * is a REQUEST handed to the venue over WhatsApp, which the VENUE confirms.
 *
 * The copy says exactly that at every step. It never claims the table is
 * booked, because nothing here can know that.
 *
 * Everything is derived from the venue's own `whatsappNumber`: when it is
 * absent the CTA is not rendered at all (an empty channel must not produce a
 * dead button on a screen nobody can click away).
 */

const MIN_PARTY = 1;
const MAX_PARTY = 20;

/** Local `YYYY-MM-DD` so the date input's `min` is the venue's own today. */
const todayIso = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const nowTime = (): string => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

interface FormState {
  name: string;
  partySize: number;
  date: string;
  time: string;
  notes: string;
}

export const LiveReserveCta: React.FC<{
  restaurantName: string;
  whatsappNumber: string;
  onOpen: () => void;
  /** Hidden while another overlay owns the screen. */
  hidden?: boolean;
}> = ({ restaurantName, onOpen, hidden }) => {
  if (hidden) return null;
  return (
    <button
      type="button"
      className="display-menu__cta"
      onClick={onOpen}
      aria-label={`احجز طاولتك في ${restaurantName}`}
    >
      <Armchair className="display-menu__cta-icon" aria-hidden="true" />
      <span>احجز طاولتك</span>
      <span className="display-menu__cta-pulse" aria-hidden="true" />
    </button>
  );
};

export const LiveReservationPanel: React.FC<{
  isOpen: boolean;
  restaurantName: string;
  whatsappNumber: string;
  onClose: () => void;
}> = ({ isOpen, restaurantName, whatsappNumber, onClose }) => {
  const [form, setForm] = useState<FormState>(() => ({
    name: '',
    partySize: 2,
    date: todayIso(),
    time: nowTime(),
    notes: '',
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [sent, setSent] = useState(false);

  useDialog({ isOpen, onClose });

  const dial = useMemo(() => normalizeWhatsappNumber(whatsappNumber), [whatsappNumber]);

  const patch = useCallback((changes: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...changes }));
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(changes) as (keyof FormState)[]) delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    const name = form.name.trim();
    if (name.length < 2) next.name = 'اكتب الاسم كما تحب أن نناديك';
    else if (name.length > 60) next.name = 'الاسم طويل جداً';

    if (!Number.isFinite(form.partySize) || form.partySize < MIN_PARTY || form.partySize > MAX_PARTY) {
      next.partySize = `عدد الأشخاص بين ${MIN_PARTY} و${MAX_PARTY}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) next.date = 'اختر تاريخ الحجز';
    else if (form.date < todayIso()) next.date = 'التاريخ في الماضي — اختر يوماً قادماً';
    if (!/^\d{2}:\d{2}$/.test(form.time)) next.time = 'اختر وقت الحجز';
    if (form.notes.length > 300) next.notes = 'الملاحظة طويلة جداً (300 حرف كحد أقصى)';

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form]);

  const handleSend = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!dial) return;
      if (!validate()) return;

      const message = buildReservationMessage({
        restaurantName,
        name: form.name,
        partySize: form.partySize,
        date: form.date,
        time: form.time,
        notes: form.notes,
      });
      // The URL is always `https://wa.me/<digits>` (or null) — see
      // `buildWhatsappUrl`. It is never a caller-supplied or venue-supplied
      // link, so opening it cannot become an open redirect.
      const whatsappUrl = buildWhatsappUrl(dial, message);
      if (!whatsappUrl) return;

      const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      // A popup blocker can swallow the tab; the link is still offered below.
      setSent(true);
      if (!opened) setErrors({ notes: 'تعذر فتح واتساب تلقائياً — استخدم الزر أدناه' });
    },
    [dial, form, restaurantName, validate]
  );

  if (!isOpen || !dial) return null;

  const messagePreview = buildReservationMessage({
    restaurantName,
    name: form.name.trim() || '—',
    partySize: form.partySize,
    date: form.date,
    time: form.time,
    notes: form.notes,
  });
  const directUrl = buildWhatsappUrl(dial, messagePreview) || `https://wa.me/${dial}`;

  return (
    <div className="display-menu__sheet" {...dialogProps({ label: 'احجز طاولتك' })}>
      <div className="display-menu__sheet-card">
        <button
          type="button"
          className="display-menu__sheet-close"
          onClick={onClose}
          aria-label="إغلاق نموذج الحجز"
        >
          <X aria-hidden="true" />
        </button>

        <header className="display-menu__sheet-head">
          <span className="display-menu__sheet-mark" aria-hidden="true">
            <Armchair />
          </span>
          <div>
            <h2 className="display-menu__sheet-title">احجز طاولتك</h2>
            <p className="display-menu__sheet-sub">في {restaurantName}</p>
          </div>
        </header>

        {sent ? (
          <div className="display-menu__sheet-sent">
            <span className="display-menu__sheet-sent-mark" aria-hidden="true">
              <Check />
            </span>
            <h3>تم فتح واتساب</h3>
            <p>
              طلبك في طريقه إلى <strong>{restaurantName}</strong>.<br />
              التأكيد يأتي من المطعم مباشرة — لم يتم تأكيد الحجز بعد.
            </p>
            <a
              className="display-menu__sheet-link"
              href={directUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Send aria-hidden="true" />
              فتح واتساب مرة أخرى
            </a>
            <button type="button" className="display-menu__sheet-btn" onClick={onClose}>
              العودة إلى القائمة
            </button>
          </div>
        ) : (
          <form className="display-menu__sheet-form" onSubmit={handleSend} noValidate>
            <p className="display-menu__sheet-note">
              يُرسل طلبك إلى واتساب المطعم، ويقوم المطعم بتأكيد الحجز معك.
            </p>

            <div className="display-menu__field">
              <label htmlFor="live-reserve-name">الاسم</label>
              <input
                id="live-reserve-name"
                data-autofocus
                type="text"
                value={form.name}
                maxLength={60}
                autoComplete="name"
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="الاسم الثلاثي"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'live-reserve-name-error' : undefined}
              />
              {errors.name && (
                <span id="live-reserve-name-error" className="display-menu__field-error">
                  {errors.name}
                </span>
              )}
            </div>

            <div className="display-menu__field">
              <label htmlFor="live-reserve-party">عدد الأشخاص</label>
              <div className="display-menu__stepper">
                <button
                  type="button"
                  onClick={() => patch({ partySize: Math.max(MIN_PARTY, form.partySize - 1) })}
                  disabled={form.partySize <= MIN_PARTY}
                  aria-label="إنقاص عدد الأشخاص"
                >
                  <Minus aria-hidden="true" />
                </button>
                <output id="live-reserve-party" aria-live="polite">
                  <Users aria-hidden="true" />
                  {form.partySize}
                </output>
                <button
                  type="button"
                  onClick={() => patch({ partySize: Math.min(MAX_PARTY, form.partySize + 1) })}
                  disabled={form.partySize >= MAX_PARTY}
                  aria-label="زيادة عدد الأشخاص"
                >
                  <Plus aria-hidden="true" />
                </button>
              </div>
              {errors.partySize && (
                <span className="display-menu__field-error">{errors.partySize}</span>
              )}
            </div>

            <div className="display-menu__field-row">
              <div className="display-menu__field">
                <label htmlFor="live-reserve-date">
                  <CalendarDays aria-hidden="true" /> التاريخ
                </label>
                <input
                  id="live-reserve-date"
                  type="date"
                  value={form.date}
                  min={todayIso()}
                  onChange={(event) => patch({ date: event.target.value })}
                  aria-invalid={errors.date ? true : undefined}
                />
                {errors.date && <span className="display-menu__field-error">{errors.date}</span>}
              </div>

              <div className="display-menu__field">
                <label htmlFor="live-reserve-time">
                  <Clock3 aria-hidden="true" /> الوقت
                </label>
                <input
                  id="live-reserve-time"
                  type="time"
                  value={form.time}
                  onChange={(event) => patch({ time: event.target.value })}
                  aria-invalid={errors.time ? true : undefined}
                />
                {errors.time && <span className="display-menu__field-error">{errors.time}</span>}
              </div>
            </div>

            <div className="display-menu__field">
              <label htmlFor="live-reserve-notes">
                ملاحظات <span className="display-menu__field-optional">(اختياري)</span>
              </label>
              <textarea
                id="live-reserve-notes"
                rows={2}
                maxLength={300}
                value={form.notes}
                onChange={(event) => patch({ notes: event.target.value })}
                placeholder="مثال: طاولة قريبة من النافذة، أو مناسبة نحتفل بها."
              />
              {errors.notes && <span className="display-menu__field-error">{errors.notes}</span>}
            </div>

            <button type="submit" className="display-menu__sheet-submit">
              <Send aria-hidden="true" />
              إرسال الطلب عبر واتساب
            </button>
            <p className="display-menu__sheet-fineprint">
              الشاشة ترسل الطلب فقط — التأكيد من إدارة المطعم.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
