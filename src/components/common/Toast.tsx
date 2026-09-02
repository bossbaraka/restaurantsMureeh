import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useRestaurant();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-4 right-4 z-50 flex flex-col items-center pointer-events-none gap-2 sm:right-auto sm:left-6 sm:max-w-md sm:items-start">
      {toasts.map((toast) => {
        const icons = {
          success: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
          warning: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
          error: <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />,
          info: <Info className="w-5 h-5 text-gold-400 shrink-0" />,
        };

        const borders = {
          success: 'border-emerald-500/30 bg-luxury-900/95',
          warning: 'border-amber-500/30 bg-luxury-900/95',
          error: 'border-red-500/30 bg-luxury-900/95',
          info: 'border-gold-500/30 bg-luxury-900/95',
        };

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl shadow-luxury border backdrop-blur-md text-luxury-50 transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 w-full ${borders[toast.type]}`}
          >
            {icons[toast.type]}
            <div className="flex-1 text-right">
              <h4 className="text-sm font-semibold text-luxury-100">{toast.title}</h4>
              {toast.message && (
                <p className="text-xs text-luxury-300 mt-0.5 leading-relaxed">{toast.message}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-luxury-400 hover:text-luxury-200 p-1 -mr-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
