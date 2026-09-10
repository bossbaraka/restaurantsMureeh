import React, { useState } from 'react';
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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#D4AF37', '#C5A880', '#10B981', '#FFFFFF'],
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
      <div className="bg-luxury-900 border border-luxury-750 rounded-3xl w-full max-w-md p-6 relative shadow-2xl text-center">
        <button
          onClick={onClose}
          className="absolute left-4 top-4 p-2 rounded-xl text-luxury-400 hover:text-white bg-luxury-800/60 hover:bg-luxury-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {isSubmitted ? (
          <div className="py-8 space-y-3 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-[0_0_22px_-6px_var(--brand-glow)]">
              <Heart className="w-8 h-8 fill-emerald-400" />
            </div>
            <h3 className="text-xl font-bold font-serif text-luxury-50">شكراً لك من القلب!</h3>
            <p className="text-xs text-luxury-300">
              تقييمك يساعد طاقم {currentRestaurant?.name || 'المطعم'} على الاستمرار في تقديم أعلى معايير الضيافة.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1 pt-2">
              <span className="text-xs text-[var(--brand-primary-strong)] font-bold uppercase tracking-widest">
                {currentRestaurant?.name || 'تجربة الضيافة'}
              </span>
              <h2 className="text-xl font-bold font-serif text-luxury-50">
                كيف كانت تجربتك معنا اليوم؟
              </h2>
              <p className="text-xs text-luxury-400">
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
                          ? 'text-[var(--brand-primary-strong)] fill-[var(--brand-primary-strong)] drop-shadow-[0_0_8px_rgba(212,175,55,0.5)]'
                          : 'text-luxury-700'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="text-xs font-bold text-[var(--brand-primary-strong)]">
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
                className="w-full bg-luxury-950 border border-luxury-800 rounded-2xl p-3 text-xs text-luxury-100 placeholder-luxury-500 focus:outline-none focus:border-[rgb(var(--brand-primary-strong-rgb)/0.6)] resize-none"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[var(--brand-primary-strong)] via-[var(--brand-primary-strong)] to-[var(--brand-primary-strong)] text-luxury-950 font-bold text-xs shadow-[0_0_22px_-6px_var(--brand-glow)] hover:from-[var(--brand-primary-strong)] hover:to-[var(--brand-primary-strong)] transition-all cursor-pointer flex items-center justify-center gap-2"
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
