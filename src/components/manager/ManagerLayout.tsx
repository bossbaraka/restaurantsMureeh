import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
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
  ChevronDown,
  Plus,
  Users,
} from 'lucide-react';

export type ManagerTab =
  | 'OVERVIEW'
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
  const { currentUser, isSuperAdmin, isDemoAccount, canAccessManagerTab, setIsLoginModalOpen, switchManagerRestaurant } = useAuth();
  const [activeTab, setActiveTab] = useState<ManagerTab>('OVERVIEW');
  const [isTenantDropdownOpen, setIsTenantDropdownOpen] = useState(false);

  const pendingWaiters = waiterRequests.filter((w) => w.status === 'PENDING').length;
  const activeOrdersCount = orders.filter((o) => o.status === 'PENDING' || o.status === 'PREPARING').length;

  const navConfig: Array<{ id: ManagerTab; label: string; icon: React.ReactNode; badge?: number; badgeColor?: string; section?: string }> = [
    { id: 'OVERVIEW', label: 'لوحة العمليات', icon: <LayoutDashboard className="w-4 h-4" /> },
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
  ];

  const navItems = navConfig.filter((item) => canAccessManagerTab(item.id));

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
          {/* Tenant Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsTenantDropdownOpen(!isTenantDropdownOpen)}
              className="w-full p-2.5 rounded-xl bg-luxury-900 hover:bg-luxury-850 border border-luxury-750 flex items-center justify-between transition-colors text-right"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-luxury-950 font-serif font-bold text-sm shrink-0 shadow-gold-glow"
                  style={{
                    background: `linear-gradient(135deg, ${currentRestaurant?.primaryColor || '#D4AF37'}, ${currentRestaurant?.accentColor || '#C5A880'})`,
                  }}
                >
                  {currentRestaurant?.nameEn.charAt(0) || 'M'}
                </div>
                <div className="min-w-0">
                  <h1 className="text-xs font-bold text-luxury-50 truncate font-serif">
                    {currentRestaurant?.name || 'اختر مطعماً'}
                  </h1>
                  <span className="text-[10px] text-gold-400 font-mono block truncate">
                    /r/{currentRestaurant?.slug}
                  </span>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-luxury-400 shrink-0" />
            </button>

            {/* Dropdown Menu */}
            {isTenantDropdownOpen && (
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

          {/* Navigation Items */}
          <nav className="flex md:flex-col gap-1 overflow-x-auto no-scrollbar py-1 md:py-0">
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
        {isDemoAccount && (
          <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-right text-sm text-amber-200" dir="rtl">
            <strong className="block font-bold">أنت مسجل الآن في حساب تجريبي للعرض فقط</strong>
            <span className="text-xs text-amber-300/80">لا توجد لهذا الحساب صلاحية إجراء تغييرات حقيقية على المطعم أو قاعدة البيانات.</span>
          </div>
        )}
        {activeTab === 'OVERVIEW' && <DashboardOverview onNavigateTab={setActiveTab} />}
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
    </div>
  );
};
