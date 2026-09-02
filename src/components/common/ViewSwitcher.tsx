import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import {
  Smartphone,
  LayoutDashboard,
  Columns,
  Volume2,
  VolumeX,
  RotateCcw,
  Zap,
  QrCode,
  ShieldCheck,
  ChefHat,
  Sparkles,
  User,
  Globe,
  Plus,
} from 'lucide-react';

export const ViewSwitcher: React.FC = () => {
  const {
    viewMode,
    setViewMode,
    activeTableId,
    currentRestaurant,
    tenantsList,
    setCurrentTenantBySlug,
    soundEnabled,
    toggleSound,
    resetAllDemoData,
    waiterRequests,
    orders,
    setIsTableSelectorOpen,
    setIsOnboardingOpen,
  } = useRestaurant();

  const { currentUser, isSuperAdmin, canAccessView, setIsLoginModalOpen, switchManagerRestaurant } = useAuth();

  const pendingWaiterCount = waiterRequests.filter((w) => w.status === 'PENDING').length;
  const activeOrdersCount = orders.filter((o) => o.status === 'PENDING' || o.status === 'PREPARING').length;

  const allowedViewModes = [
    { id: 'CUSTOMER', label: 'المنيو (الزبون)', icon: Smartphone, show: canAccessView('CUSTOMER') },
    { id: 'MANAGER', label: 'لوحة المطعم', icon: LayoutDashboard, show: canAccessView('MANAGER') },
    { id: 'KITCHEN_KDS', label: 'المطبخ (KDS)', icon: ChefHat, show: canAccessView('KITCHEN_KDS') },
    { id: 'SAAS_LANDING', label: 'صفحة العرض (SaaS)', icon: Globe, show: canAccessView('SAAS_LANDING') },
    { id: 'PLATFORM_ADMIN', label: 'إدارة المنصة', icon: ShieldCheck, show: canAccessView('PLATFORM_ADMIN') },
    { id: 'SPLIT_PREVIEW', label: 'العرض المزدوج', icon: Columns, show: canAccessView('SPLIT_PREVIEW') },
  ];

  return (
    <header className="sticky top-0 z-40 bg-luxury-950/95 backdrop-blur-md border-b border-luxury-800 text-luxury-100 text-xs select-none shadow-md">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
        {/* Brand & Multi-Tenant Selector */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-luxury-950 shadow-gold-glow font-serif font-bold text-base cursor-pointer shrink-0"
            style={{
              background: `linear-gradient(135deg, ${currentRestaurant?.primaryColor || '#D4AF37'}, ${currentRestaurant?.accentColor || '#C5A880'})`,
            }}
            onClick={() => setViewMode('CUSTOMER')}
            title="العودة لمنيو العميل الفاخر"
          >
            {currentRestaurant?.nameEn.charAt(0) || 'M'}
          </div>

          <div className="relative">
            <select
              value={currentRestaurant?.slug || 'merar'}
              onChange={(e) => {
                const slug = e.target.value;
                if (slug === '__NEW__' && isSuperAdmin) {
                  setIsOnboardingOpen(true);
                } else {
                  setCurrentTenantBySlug(slug);
                  const target = tenantsList.find((t) => t.slug === slug);
                  if (target) switchManagerRestaurant(target.id);
                }
              }}
              className="bg-luxury-900 border border-luxury-750 text-luxury-100 rounded-lg px-2.5 py-1 text-xs font-bold focus:outline-none focus:border-gold-500/60 font-serif cursor-pointer max-w-[120px] sm:max-w-[180px] truncate"
            >
              <optgroup label="المطاعم المشتركة">
                {tenantsList.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              {isSuperAdmin && (
                <option value="__NEW__" className="text-gold-400 font-bold">
                  + إضافة مطعم جديد
                </option>
              )}
            </select>
          </div>
        </div>

        {/* Center View Mode Selector Tabs */}
        <div className="flex items-center bg-luxury-900 p-1 rounded-xl border border-luxury-800 overflow-x-auto no-scrollbar">
          {allowedViewModes.filter((mode) => mode.show).map((mode) => {
            const Icon = mode.icon;
            const isActive = viewMode === mode.id;

            return (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id as any)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? mode.id === 'KITCHEN_KDS'
                      ? 'bg-amber-500 text-luxury-950 shadow-sm font-bold'
                      : mode.id === 'PLATFORM_ADMIN'
                        ? 'bg-purple-600 text-white shadow-sm font-bold'
                        : 'bg-gold-500 text-luxury-950 shadow-sm font-bold'
                    : 'text-luxury-300 hover:text-luxury-100 hover:bg-luxury-850'
                }`}
                title={mode.label}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="text-xs">{mode.label}</span>

                {mode.id === 'MANAGER' && (pendingWaiterCount > 0 || activeOrdersCount > 0) && (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}

                {mode.id === 'KITCHEN_KDS' && activeOrdersCount > 0 && (
                  <span className="text-[10px] bg-amber-400/20 text-amber-300 px-1.5 rounded-full font-mono font-bold">
                    {activeOrdersCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Tools: Table Selector + Auth */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setIsTableSelectorOpen(true)}
            className="flex items-center gap-1.5 bg-luxury-850 hover:bg-luxury-800 text-luxury-200 border border-luxury-750 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
            title="تغيير طاولة العميل الحالية"
          >
            <QrCode className="w-3.5 h-3.5 text-gold-400" />
            <span>{activeTableId ? `طاولة ${activeTableId.replace('TABLE-', '')}` : 'اختر طاولة'}</span>
          </button>

          <button
            onClick={() => setIsLoginModalOpen(true)}
            className="flex items-center gap-1.5 bg-luxury-850 hover:bg-luxury-800 text-luxury-300 hover:text-luxury-100 border border-luxury-750 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
            title="تسجيل دخول المدير أو العمال"
          >
            <User className="w-3.5 h-3.5 text-gold-400" />
            <span className="hidden md:inline">
              {currentUser ? currentUser.name.split(' ')[0] : 'دخول الإدارة'}
            </span>
          </button>

          <button
            onClick={toggleSound}
            className="p-2 rounded-lg bg-luxury-850 hover:bg-luxury-800 text-luxury-300 hover:text-luxury-100 border border-luxury-750 transition-colors cursor-pointer"
            title={soundEnabled ? 'كتم الصوت' : 'تفعيل المؤثرات الصوتية'}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-gold-400" /> : <VolumeX className="w-3.5 h-3.5 text-luxury-500" />}
          </button>

          <button
            onClick={resetAllDemoData}
            className="p-2 rounded-lg bg-luxury-850 hover:bg-luxury-800 text-luxury-400 hover:text-luxury-100 border border-luxury-750 transition-colors cursor-pointer hidden sm:block"
            title="إعادة تعيين البيانات التجريبية"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
