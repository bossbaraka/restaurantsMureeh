import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'gold' | 'emerald' | 'amber' | 'blue' | 'purple' | 'red' | 'neutral';
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'gold',
  size = 'sm',
  dot = false,
  className = '',
}) => {
  const sizeStyles = {
    xs: 'text-[10px] px-1.5 py-0.5 font-medium',
    sm: 'text-xs px-2.5 py-1 font-medium',
    md: 'text-sm px-3 py-1.5 font-medium',
  };

  const variantStyles = {
    gold: 'bg-gold-500/10 text-gold-400 border border-gold-500/30',
    emerald: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
    blue: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
    purple: 'bg-purple-500/10 text-purple-400 border border-purple-500/30',
    red: 'bg-red-500/10 text-red-400 border border-red-500/30',
    neutral: 'bg-luxury-800 text-luxury-300 border border-luxury-700',
  };

  const dotColor = {
    gold: 'bg-gold-400',
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    blue: 'bg-blue-400',
    purple: 'bg-purple-400',
    red: 'bg-red-400',
    neutral: 'bg-luxury-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full backdrop-blur-sm ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor[variant]}`} />}
      {children}
    </span>
  );
};
