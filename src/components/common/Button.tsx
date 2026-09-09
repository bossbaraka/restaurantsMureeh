import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'gold' | 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'gold',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  // DS-002: `focus:outline-none` with no replacement left keyboard users with
  // no focus indicator. Replaced with a `focus-visible` ring, which never
  // paints on mouse click but always paints for keyboard/AT navigation.
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-all duration-200 select-none active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 rounded-lg focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-luxury-950';

  // DS-003: `sm` was 26px tall and `md` 38px — both below the ~44px
  // recommended touch target. `min-h` raises the hit area on touch devices
  // without changing the horizontal rhythm or the text size.
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs gap-1.5 min-h-[36px]',
    md: 'px-4 py-2.5 text-sm gap-2 min-h-[44px]',
    lg: 'px-6 py-3.5 text-base gap-2.5 font-semibold min-h-[48px]',
  };

  const variantStyles = {
    gold: 'bg-gradient-to-r from-gold-500 to-gold-600 text-luxury-950 font-bold hover:from-gold-400 hover:to-gold-500 shadow-gold-glow',
    primary: 'bg-luxury-800 text-luxury-50 hover:bg-luxury-750 border border-luxury-700',
    secondary: 'bg-luxury-900 text-luxury-200 hover:bg-luxury-850 border border-luxury-800',
    outline: 'bg-transparent text-gold-400 border border-gold-600/40 hover:bg-gold-500/10 hover:border-gold-500',
    danger: 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25',
    ghost: 'bg-transparent text-luxury-300 hover:text-luxury-50 hover:bg-luxury-800/60',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled || isLoading}
      // DS-005: announce the pending state to assistive tech. Without this a
      // screen-reader user only hears the button go silent while it spins.
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span
          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
      ) : (
        icon && (
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
        )
      )}
      {/* DS-004: only render the label wrapper when there IS a label.
          Icon-only buttons previously emitted an empty <span>, which added a
          stray flex gap and made the button wider than its icon. */}
      {children != null && children !== false && <span>{children}</span>}
    </button>
  );
};
