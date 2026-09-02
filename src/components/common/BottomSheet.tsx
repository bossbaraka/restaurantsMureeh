import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Sheet panel */}
      <div
        className="relative w-full max-w-xl mx-auto bg-luxury-900 border-t border-luxury-700/80 rounded-t-3xl shadow-2xl z-10 flex flex-col max-h-[92vh] animate-in slide-in-from-bottom duration-300"
        dir="rtl"
      >
        {/* Grab bar */}
        <div className="w-12 h-1 bg-luxury-700 rounded-full mx-auto my-3 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-4 border-b border-luxury-800 shrink-0">
          <div className="text-right">
            {typeof title === 'string' ? (
              <h3 className="text-lg font-bold text-luxury-50">{title}</h3>
            ) : (
              title
            )}
            {subtitle && <p className="text-xs text-luxury-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {/* Sticky Footer */}
        {footer && (
          <div className="p-4 sm:px-6 bg-luxury-950 border-t border-luxury-800 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
