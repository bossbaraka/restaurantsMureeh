import React, { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useRestaurant } from '../../context/RestaurantContext';
import { Star, Heart, CheckCircle2, MessageSquare, Send, X, Share2 } from 'lucide-react';
import { formatTableNumber } from '../../utils/formatting';
import confetti from 'canvas-confetti';

interface CustomerRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId?: string;
}

export const CustomerRatingModal: React.FC<CustomerRatingModalProps> = ({ isOpen, onClose, orderId }) => {
  const { currentRestaurant, showToast, activeTableId, activeTableNumber, activeTable } = useRestaurant();
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  useDialog({ isOpen, onClose });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        // THEME-EXEMPT (canvas/rasterization): canvas-confetti paints particles
        // onto its own <canvas> and cannot read CSS custom properties. Per the
        // migration rule "DOM UI -> semantic CSS tokens, canvas -> pure resolved
        // values", these stay literal. A celebratory particle burst is also
        // decorative rather than restaurant theming.
        colors: [
          '#D4AF37', // THEME-EXEMPT (canvas): confetti particle palette
          '#C5A880', // THEME-EXEMPT (canvas)
          '#10B981', // THEME-EXEMPT (canvas)
          '#FFFFFF', // THEME-EXEMPT (canvas)
        ],
      });
    } catch {}

    showToast('success', 'شكراً لتقييمك!', 'يسعدنا دائماً تقديم أرقى تجربة ضيافة لكم.');
    setTimeout(() => {
      onClose();
      setIsSubmitted(false);
      setFeedback('');
    }, 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in" dir="rtl">
      <div role="dialog" aria-modal="true" aria-label="تقييم تجربة المطعم" className="bg-m-surface border border-m-hairline rounded-3xl w-full max-w-md p-6 relative shadow-2xl text-center">
        <button
          onClick={onClose}
          className="absolute left-4 top-4 p-2 rounded-xl text-m-text-muted hover:text-white bg-m-surface-raised/60 hover:bg-m-surface-raised transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {isSubmitted ? (
          <div className="py-8 space-y-3 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
              <Heart className="w-8 h-8 fill-emerald-400" />
            </div>
            <h3 className="text-xl font-bold font-serif text-m-text">شكراً لك من القلب!</h3>
            <p className="text-xs text-m-text-muted">
              تقييمك يساعد طاقم {currentRestaurant?.name || 'المطعم'} على الاستمرار في تقديم أعلى معايير الضيافة.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1 pt-2">
              <span className="text-xs text-[var(--m-brand-on-surface)] font-bold uppercase tracking-widest">
                {currentRestaurant?.name || 'تجربة الضيافة'}
              </span>
              <h2 className="text-xl font-bold font-serif text-m-text">
                كيف كانت تجربتك معنا اليوم؟
              </h2>
              <p className="text-xs text-m-text-muted">
                {(activeTableNumber != null
                  ? `طاولة ${activeTableNumber}`
                  : activeTable?.tableNumber != null
                  ? `طاولة ${activeTable.tableNumber}`
                  : activeTableId
                  ? `طاولة ${formatTableNumber(activeTableId) || '—'}`
                  : '')} · رأيك يصنع الفرق
              </p>
            </div>

            {/* Star Rating Selector */}
            <div className="flex items-center justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const isFilled = (hoverRating !== null ? hoverRating : rating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    onClick={() => setRating(star)}
                    className="p-1.5 transition-transform hover:scale-125 focus:outline-none cursor-pointer"
                  >
                    <Star
                      className={`w-8 h-8 transition-colors ${
                        isFilled
                          ? 'text-[var(--m-brand-on-surface)] fill-[var(--m-brand-on-surface)] drop-shadow-[0_0_8px_rgb(var(--m-brand-on-surface-rgb)/0.5)]'
                          : 'text-m-text-subtle'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="text-xs font-bold text-[var(--m-brand-on-surface)]">
              {rating === 5 && '🌟 تجربة استثنائية لا تُنسى!'}
              {rating === 4 && '✨ خدمة ممتازة جداً'}
              {rating === 3 && '👍 جيدة، ونتطلع للأفضل'}
              {rating === 2 && '⚠️ مقبولة، توجد ملاحظات'}
              {rating === 1 && '💔 لم ترقَ لتطلعاتكم'}
            </div>

            {/* Feedback Text Area */}
            <div>
              <textarea aria-label="أخبرنا عن أكثر طبق نال إعجابك أو أي ملاحظة تود مشاركتها مع الإدارة..."
                rows={3}
                placeholder="أخبرنا عن أكثر طبق نال إعجابك أو أي ملاحظة تود مشاركتها مع الإدارة..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="w-full bg-m-bg border border-m-hairline rounded-2xl p-3 text-xs text-m-text placeholder-m-text-subtle focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)] resize-none"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[var(--m-brand-on-surface)] via-[var(--m-brand-on-surface)] to-[var(--m-brand-on-surface)] text-m-bg font-bold text-xs hover:from-[var(--m-brand-on-surface)] hover:to-[var(--m-brand-on-surface)] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>إرسال التقييم للإدارة</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
