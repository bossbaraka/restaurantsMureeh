import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../hooks/useDialog';
import { DashboardOverview } from './DashboardOverview';
import { OrderManagement } from './OrderManagement';
import { TableManagement } from './TableManagement';
import { QRManagement } from './QRManagement';
import { MenuManagement } from './MenuManagement';
import { OffersManagement } from './OffersManagement';
import { WaiterRequestsList } from './WaiterRequestsList';
import { AnalyticsView } from './AnalyticsView';
import { BrandingSettingsView } from './BrandingSettingsView';
import { SubscriptionView } from './SubscriptionView';
import { StaffManagement } from './StaffManagement';
import { CashierPOSView } from './CashierPOSView';
import { BranchManagementView } from './BranchManagementView';
import {
  LayoutDashboard,
  ChefHat,
  MapPin,
  QrCode,
  Utensils,
  Flame,
  Bell,
  Smartphone,
  ShieldCheck,
  ExternalLink,
  BarChart3,
  Palette,
  CreditCard,
  Building2,
  Calculator,
  ChevronDown,
  ChevronLeft,
  Menu,
  X,
  Plus,
  Users,
} from 'lucide-react';

export type ManagerTab =
  | 'OVERVIEW'
  | 'POS'
  | 'BRANCHES'
  | 'ORDERS'
  | 'TABLES'
  | 'QR'
  | 'MENU'
  | 'OFFERS'
  | 'WAITERS'
  | 'STAFF'
  | 'ANALYTICS'
  | 'BRANDING'
  | 'SUBSCRIPTION';

export const ManagerLayout: React.FC = () => {
  const { orders, waiterRequests, setViewMode, currentRestaurant, tenantsList, setCurrentTenantBySlug, setIsOnboardingOpen } = useRestaurant();
  const { isSuperAdmin, canAccessManagerTab, switchManagerRestaurant } = useAuth();
  // Multi-tenant (shared restaurants) switching is reserved for the platform
  // manager; a tenant manager only ever operates inside his own restaurant.
  const isPlatformManager = isSuperAdmin;
  const [activeTab, setActiveTab] = useState<ManagerTab>('OVERVIEW');
  const [isTenantDropdownOpen, setIsTenantDropdownOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const pendingWaiters = waiterRequests.filter((w) => w.status === 'PENDING').length;
  const activeOrdersCount = orders.filter((o) => o.status === 'PENDING' || o.status === 'PREPARING').length;
  const totalAlerts = pendingWaiters + activeOrdersCount;

  // Mobile nav sheet: Escape-to-close + body scroll lock (see hooks/useDialog).
  useDialog({ isOpen: isMobileNavOpen, onClose: () => setIsMobileNavOpen(false) });

  const navConfig: Array<{ id: ManagerTab; label: string; icon: React.ReactNode; badge?: number; badgeColor?: string; section?: string }> = [
    { id: 'OVERVIEW', label: 'لوحة العمليات', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'POS', label: 'الكاشير (POS)', icon: <Calculator className="w-4 h-4" /> },
    {
      id: 'ORDERS',
      label: 'شاشة الطلبات والمطبخ',
      icon: <ChefHat className="w-4 h-4" />,
      badge: activeOrdersCount > 0 ? activeOrdersCount : undefined,
      badgeColor: 'bg-amber-500 text-luxury-950',
    },
    { id: 'TABLES', label: 'خريطة الطاولات', icon: <MapPin className="w-4 h-4" /> },
    { id: 'QR', label: 'إدارة وطباعة QR', icon: <QrCode className="w-4 h-4" /> },
    { id: 'MENU', label: 'قائمة الأطباق والتسعير', icon: <Utensils className="w-4 h-4" /> },
    { id: 'OFFERS', label: 'العروض والكومبو', icon: <Flame className="w-4 h-4" /> },
    {
      id: 'WAITERS',
      label: 'نداءات طاقم الضيافة',
      icon: <Bell className="w-4 h-4" />,
      badge: pendingWaiters > 0 ? pendingWaiters : undefined,
      badgeColor: 'bg-red-500 text-white animate-pulse',
    },
    { id: 'STAFF', label: 'العمال وطاقم الخدمة', icon: <Users className="w-4 h-4" /> },
    { id: 'ANALYTICS', label: 'التحليلات والمبيعات', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'BRANDING', label: 'الهوية والمظهر', icon: <Palette className="w-4 h-4" /> },
    { id: 'SUBSCRIPTION', label: 'الباقة والاشتراك', icon: <CreditCard className="w-4 h-4" /> },
  { id: 'BRANCHES', label: 'الفروع المتعددة', icon: <Building2 className="w-4 h-4" /> },
  ];

  const navItems = navConfig.filter((item) => canAccessManagerTab(item.id));
  const activeNavItem = navItems.find((item) => item.id === activeTab);

  React.useEffect(() => {
    if (navItems.length > 0 && !navItems.some((item) => item.id === activeTab)) {
      setActiveTab(navItems[0].id);
    }
  }, [activeTab, navItems]);

  const handleSwitchTenant = (slug: string, restId: string) => {
    setCurrentTenantBySlug(slug);
    switchManagerRestaurant(restId);
    setIsTenantDropdownOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#0A0B0D] text-luxury-50 flex flex-col md:flex-row" dir="rtl">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-luxury-950 border-b md:border-b-0 md:border-l border-luxury-800 p-4 shrink-0 flex flex-col justify-between">
        <div className="space-y-5">
          {/* Tenant Selector Dropdown (platform manager only) */}
          <div className="relative">
            <button
              onClick={() => (isPlatformManager ? setIsTenantDropdownOpen(!isTenantDropdownOpen) : undefined)}
              className="w-full p-2.5 rounded-xl bg-luxury-900 hover:bg-luxury-850 border border-luxury-750 flex items-center justify-between transition-colors text-right"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden text-luxury-950 font-serif font-bold text-sm shrink-0 shadow-gold-glow"
                  style={{
                    background: `linear-gradient(135deg, ${currentRestaurant?.primaryColor || '#D4AF37'}, ${currentRestaurant?.accentColor || '#C5A880'})`,
                  }}
                >
                  {currentRestaurant?.logo ? (
                    <img src={currentRestaurant.logo} alt={currentRestaurant?.name || ''} className="w-full h-full object-cover" />
                  ) : (
                    currentRestaurant?.nameEn.charAt(0) || 'M'
                  )}
                </div>
                <div className="min-w-0">
                  <h1 className="text-xs font-bold text-luxury-50 truncate font-serif">
                    {currentRestaurant?.name || (isPlatformManager ? 'اختر مطعماً' : 'مطعمي')}
                  </h1>
                  <span className="text-[10px] text-gold-400 font-mono block truncate" dir="ltr">
                    {isPlatformManager ? `/r/${currentRestaurant?.slug || ''}` : currentRestaurant?.slug || ''}
                  </span>
                </div>
              </div>
              {isPlatformManager && <ChevronDown className="w-4 h-4 text-luxury-400 shrink-0" />}
            </button>

            {!isPlatformManager && (
              <div className="mt-1.5 rounded-lg bg-luxury-950/60 border border-luxury-800 px-2.5 py-1.5 text-[10px] text-luxury-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                أنت داخل حساب مطعمك فقط — بقية المطاعم لا تظهر هنا
              </div>
            )}

            {/* Dropdown Menu */}
            {isTenantDropdownOpen && isPlatformManager && (
              <div className="absolute top-full right-0 left-0 mt-1 bg-luxury-900 border border-luxury-750 rounded-xl shadow-2xl p-1.5 z-50 space-y-1">
                <span className="text-[10px] text-luxury-400 px-2 py-1 block font-bold">
                  المطاعم المشتركة ({tenantsList.length})
                </span>

                {tenantsList.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSwitchTenant(t.slug, t.id)}
                    className={`w-full p-2 rounded-lg text-right flex items-center justify-between text-xs transition-colors ${
                      currentRestaurant?.id === t.id
                        ? 'bg-gold-500/10 text-gold-300 font-bold'
                        : 'text-luxury-300 hover:bg-luxury-850 hover:text-luxury-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>{t.name}</span>
                    </div>
                    <span className="text-[10px] text-luxury-500 font-mono">/{t.slug}</span>
                  </button>
                ))}

                <button
                  onClick={() => {
                    setIsTenantDropdownOpen(false);
                    setIsOnboardingOpen(true);
                  }}
                  className="w-full p-2 rounded-lg text-right flex items-center gap-1.5 text-xs text-gold-400 hover:bg-gold-500/10 font-bold pt-2 border-t border-luxury-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ إضافة مطعم جديد (Onboarding)</span>
                </button>
              </div>
            )}
          </div>

          {/* Mobile trigger for the creative button-list sheet (phones only) */}
          <button
            onClick={() => setIsMobileNavOpen(true)}
            aria-label="فتح قائمة أقسام لوحة التحكم"
            className="md:hidden w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-2xl bg-gradient-to-l from-gold-500/15 via-luxury-900 to-luxury-900 border border-gold-500/30 hover:border-gold-500/60 text-luxury-100 transition-all active:scale-[0.98] cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-gold-500 text-luxury-950 flex items-center justify-center shadow-gold-glow shrink-0">
                {activeNavItem?.icon || <LayoutDashboard className="w-4 h-4" />}
              </span>
              <div className="text-right min-w-0">
                <span className="text-[10px] text-gold-400/90 font-bold block">قائمة لوحة التحكم</span>
                <span className="text-xs font-bold text-luxury-50 truncate block">{activeNavItem?.label || 'اختر القسم'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {totalAlerts > 0 && (
                <span className="min-w-[1.35rem] px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold animate-pulse text-center">
                  {totalAlerts}
                </span>
              )}
              <span className="w-8 h-8 rounded-lg bg-luxury-850 border border-luxury-750 flex items-center justify-center text-gold-400">
                <Menu className="w-4 h-4" />
              </span>
            </div>
          </button>

          {/* Navigation Items — desktop sidebar (phones use the sheet above) */}
          <nav className="hidden md:flex md:flex-col gap-1 overflow-x-auto no-scrollbar py-1 md:py-0">
            {navItems.length === 0 ? (
              <div className="text-xs text-luxury-400 px-2 py-4">لا توجد صلاحيات متاحة لهذا الدور.</div>
            ) : (
              navItems.map((item) => {
                const isSelected = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 md:shrink select-none ${
                      isSelected
                        ? 'bg-gold-500 text-luxury-950 font-bold shadow-gold-glow'
                        : 'text-luxury-300 hover:text-luxury-50 hover:bg-luxury-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {item.icon}
                      <span>{item.label}</span>
                    </div>

                    {item.badge !== undefined && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          item.badgeColor || 'bg-luxury-800 text-luxury-200'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </nav>
        </div>

        {/* Sidebar Bottom: User & Jump to Customer */}
        <div className="hidden md:block pt-4 border-t border-luxury-850 space-y-2">
          {isSuperAdmin && (
            <button
              onClick={() => setViewMode('PLATFORM_ADMIN')}
              className="w-full py-2 px-3 rounded-xl bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border border-purple-500/30 text-[11px] font-bold flex items-center justify-between transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                <span>بوابة مدير المنصة العام</span>
              </div>
              <ExternalLink className="w-3 h-3 text-purple-400" />
            </button>
          )}

          <button
            onClick={() => setViewMode('CUSTOMER')}
            className="w-full py-2.5 px-3 rounded-xl bg-luxury-900 hover:bg-luxury-850 text-gold-300 border border-luxury-800 text-xs font-semibold flex items-center justify-between transition-colors"
          >
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-gold-400" />
              <span>معاينة منيو العميل</span>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-luxury-400" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full overflow-y-auto">
        {activeTab === 'OVERVIEW' && <DashboardOverview onNavigateTab={setActiveTab} />}
        {activeTab === 'POS' && <CashierPOSView />}
        {activeTab === 'BRANCHES' && <BranchManagementView />}
        {activeTab === 'ORDERS' && <OrderManagement />}
        {activeTab === 'TABLES' && <TableManagement />}
        {activeTab === 'QR' && <QRManagement />}
        {activeTab === 'MENU' && <MenuManagement />}
        {activeTab === 'OFFERS' && <OffersManagement />}
        {activeTab === 'WAITERS' && <WaiterRequestsList />}
        {activeTab === 'STAFF' && <StaffManagement />}
        {activeTab === 'ANALYTICS' && <AnalyticsView />}
        {activeTab === 'BRANDING' && <BrandingSettingsView />}
        {activeTab === 'SUBSCRIPTION' && <SubscriptionView />}
      </main>

      {/* Mobile Navigation Sheet — creative button list (phones only) */}
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsMobileNavOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="أقسام لوحة التحكم"
            dir="rtl"
            className="relative bg-luxury-900 border-t border-gold-500/30 rounded-t-3xl z-10 animate-in slide-in-from-bottom duration-300 max-h-[85vh] overflow-y-auto no-scrollbar"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            {/* Gold ambient top line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold-500 to-transparent" />

            <div className="p-5 space-y-4">
              {/* Sheet Header */}
              <div className="flex items-center justify-between pb-3 border-b border-luxury-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-400 to-gold-700 text-luxury-950 flex items-center justify-center shadow-gold-glow shrink-0">
                    <LayoutDashboard className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-luxury-50 font-serif truncate">أقسام لوحة التحكم</h2>
                    <span className="text-[10px] text-luxury-400 block truncate">
                      {currentRestaurant?.name || ''} · {navItems.length} قسماً
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsMobileNavOpen(false)}
                  className="p-2 rounded-xl bg-luxury-850 border border-luxury-800 text-luxury-400 hover:text-white shrink-0"
                  aria-label="إغلاق القائمة"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Creative button list of sections */}
              <nav className="space-y-2">
                {navItems.map((item, index) => {
                  const isSelected = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setIsMobileNavOpen(false);
                      }}
                      className={`w-full p-3 rounded-2xl border flex items-center justify-between gap-3 transition-all active:scale-[0.98] ${
                        isSelected
                          ? 'bg-gradient-to-l from-gold-500 to-gold-600 border-gold-400 text-luxury-950 shadow-gold-glow'
                          : 'bg-luxury-850/70 border-luxury-800 text-luxury-100 hover:border-gold-500/40 hover:bg-luxury-850'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-luxury-950/15 text-luxury-950'
                              : 'bg-luxury-900 text-gold-400 border border-luxury-750'
                          }`}
                        >
                          {item.icon}
                        </span>
                        <div className="text-right min-w-0">
                          <span className={`text-sm block truncate ${isSelected ? 'font-bold' : 'font-semibold'}`}>
                            {item.label}
                          </span>
                          <span className={`text-[10px] block font-mono ${isSelected ? 'text-luxury-900/70' : 'text-luxury-500'}`}>
                            قسم {String(index + 1).padStart(2, '0')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.badge !== undefined && (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              item.badgeColor || 'bg-luxury-800 text-luxury-200'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                        <ChevronLeft className={`w-4 h-4 ${isSelected ? 'text-luxury-950' : 'text-luxury-500'}`} />
                      </div>
                    </button>
                  );
                })}
              </nav>

              {/* Quick links — the same shortcuts the desktop sidebar footer has,
                  reachable on phones too (it is hidden there). */}
              <div className="pt-2 space-y-2 border-t border-luxury-800">
                <span className="text-[10px] text-luxury-400 font-bold block px-1">روابط سريعة</span>

                {isSuperAdmin && (
                  <button
                    onClick={() => {
                      setIsMobileNavOpen(false);
                      setViewMode('PLATFORM_ADMIN');
                    }}
                    className="w-full py-3 px-3.5 rounded-2xl bg-purple-950/60 hover:bg-purple-900/60 text-purple-200 border border-purple-500/30 text-xs font-bold flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-9 h-9 rounded-xl bg-purple-900/60 border border-purple-500/40 flex items-center justify-center text-purple-300">
                        <ShieldCheck className="w-4 h-4" />
                      </span>
                      <span>بوابة مدير المنصة العام</span>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
                  </button>
                )}

                <button
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    setViewMode('CUSTOMER');
                  }}
                  className="w-full py-3 px-3.5 rounded-2xl bg-gold-500/10 hover:bg-gold-500/20 text-gold-200 border border-gold-500/30 text-xs font-bold flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-gold-500 text-luxury-950 flex items-center justify-center shadow-gold-glow">
                      <Smartphone className="w-4 h-4" />
                    </span>
                    <span>معاينة منيو العميل</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-gold-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
