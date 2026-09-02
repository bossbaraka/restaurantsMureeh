import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { Restaurant, Subscription, Plan, AuditLog } from '../../types/restaurant';
import { api } from '../../services/api';
import { db } from '../../services/db';
import { formatPrice, formatTime, formatRelativeMinutes } from '../../utils/formatting';
import {
  ShieldCheck,
  Building2,
  TrendingUp,
  CreditCard,
  Users,
  CheckCircle2,
  XCircle,
  Plus,
  ExternalLink,
  Eye,
  Search,
  Activity,
  Layers,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

export const PlatformAdminPortal: React.FC = () => {
  const { showToast, setCurrentTenantBySlug, setViewMode, setIsOnboardingOpen } = useRestaurant();
  const { currentUser, switchManagerRestaurant } = useAuth();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'RESTAURANTS' | 'SUBSCRIPTIONS' | 'LOGS'>('RESTAURANTS');

  const loadData = async () => {
    if (!currentUser) return;
    const res = await api.getPlatformOverview(currentUser);
    if (res.success && res.data) {
      setRestaurants(res.data.restaurants);
      setSubscriptions(res.data.subscriptions);
      setPlans(res.data.plans);
      setAuditLogs(res.data.auditLogs);
      setTotalRevenue(res.data.totalRevenue);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const handleToggleStatus = async (restaurantId: string, currentStatus: Restaurant['status']) => {
    if (!currentUser) return;
    const nextStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const res = await api.setTenantStatus(currentUser, restaurantId, nextStatus);
    if (res.success) {
      showToast('info', 'تم تحديث حالة المستأجر', `حالة المطعم الآن: ${nextStatus}`);
      loadData();
    }
  };

  const handleInspectRestaurant = (slug: string, restId: string) => {
    setCurrentTenantBySlug(slug);
    switchManagerRestaurant(restId);
    setViewMode('MANAGER');
    showToast('info', 'تم التبديل إلى لوحة إدارة المطعم', `مطعم: ${slug}`);
  };

  const filteredRestaurants = restaurants.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return r.name.toLowerCase().includes(q) || r.nameEn.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6 text-right max-w-7xl mx-auto p-4 sm:p-6">
      {/* Top Header Banner */}
      <div className="bg-gradient-to-r from-purple-950/80 via-luxury-900 to-luxury-950 border border-purple-500/30 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-luxury">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1 rounded-md bg-purple-500/20 text-purple-400">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <span className="text-xs font-bold text-purple-300">منصة إدارة المستأجرين السحابية (SaaS Multi-Tenant Portal)</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-luxury-50 font-serif">
            لوحة الإشراف والمتابعة المركزية للمنصة
          </h2>
          <p className="text-xs text-luxury-400 mt-1">
            مراقبة كافة المطاعم المشتركة، استهلاك الباقات، سجلات التدقيق الأمني، وحالات الاشتراكات
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsOnboardingOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة وتدشين مطعم جديد</span>
          </button>
        </div>
      </div>

      {/* Platform KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>إجمالي المطاعم</span>
            <Building2 className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-luxury-50 mt-2 font-mono">
            {restaurants.length}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">
            {restaurants.filter((r) => r.status === 'ACTIVE').length} نشطة ومفعلة
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>الاشتراكات الفعالة</span>
            <CreditCard className="w-4 h-4 text-gold-400" />
          </div>
          <div className="text-2xl font-bold text-gold-400 mt-2 font-mono">
            {subscriptions.filter((s) => s.status === 'ACTIVE' || s.status === 'TRIAL').length}
          </div>
          <div className="text-[11px] text-luxury-400 mt-1">
            {subscriptions.filter((s) => s.status === 'TRIAL').length} في الفترة التجريبية
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>إجمالي مبيعات المنصة</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-luxury-50 mt-2 font-mono">
            {formatPrice(totalRevenue)}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">
            عبر كافة المستأجرين
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>سجلات الأمان والنشاط</span>
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400 mt-2 font-mono">
            {auditLogs.length}
          </div>
          <div className="text-[11px] text-luxury-400 mt-1">
            سجلات تدقيق لحظية
          </div>
        </div>
      </div>

      {/* Tabs Navigator */}
      <div className="flex items-center gap-2 border-b border-luxury-800 pb-2">
        {[
          { id: 'RESTAURANTS', label: `المطاعم المشتركة (${restaurants.length})` },
          { id: 'SUBSCRIPTIONS', label: 'باقات الاشتراكات والأسعار' },
          { id: 'LOGS', label: `سجلات التدقيق الأمني (${auditLogs.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-gold-500 text-luxury-950 shadow-gold-glow'
                : 'bg-luxury-900 text-luxury-300 hover:text-luxury-100 border border-luxury-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: RESTAURANTS LIST */}
      {activeTab === 'RESTAURANTS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <input
                type="text"
                placeholder="بحث عن مطعم بالاسم أو الرابط..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 placeholder-luxury-500 rounded-xl py-2 pr-8 pl-3 text-xs focus:border-gold-500/60"
              />
              <Search className="w-3.5 h-3.5 text-luxury-400 absolute right-3 top-2.5" />
            </div>
          </div>

          <div className="bg-luxury-900 border border-luxury-800 rounded-2xl overflow-hidden shadow-luxury">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-luxury-850/80 border-b border-luxury-800 text-luxury-300 font-bold">
                  <tr>
                    <th className="p-4">المطعم والمستأجر</th>
                    <th className="p-4">الرابط المخصص</th>
                    <th className="p-4">الباقة الحالية</th>
                    <th className="p-4">الحالة التشغيلية</th>
                    <th className="p-4">تاريخ الانضمام</th>
                    <th className="p-4 text-left">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-luxury-800/60">
                  {filteredRestaurants.map((rest) => {
                    const sub = subscriptions.find((s) => s.restaurantId === rest.id);
                    const plan = sub ? plans.find((p) => p.id === sub.planId) : null;
                    const isActive = rest.status === 'ACTIVE';

                    return (
                      <tr key={rest.id} className="hover:bg-luxury-850/40 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={rest.logo || rest.coverImage}
                              alt=""
                              className="w-10 h-10 rounded-xl object-cover border border-luxury-800 shrink-0"
                            />
                            <div>
                              <strong className="block text-luxury-100 font-bold">{rest.name}</strong>
                              <span className="text-[11px] text-luxury-400">{rest.nameEn}</span>
                            </div>
                          </div>
                        </td>

                        <td className="p-4 font-mono text-gold-400">
                          /r/{rest.slug}
                        </td>

                        <td className="p-4">
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gold-500/10 text-gold-300 border border-gold-500/30">
                            {plan?.name || rest.planId}
                          </span>
                        </td>

                        <td className="p-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                              isActive
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-red-500/10 border-red-500/30 text-red-400'
                            }`}
                          >
                            {isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                            <span>{isActive ? 'نشط ويعمل' : 'موقوف مؤقتاً'}</span>
                          </span>
                        </td>

                        <td className="p-4 text-luxury-400 text-[11px]">
                          {formatTime(rest.createdAt)} ({formatRelativeMinutes(rest.createdAt)})
                        </td>

                        <td className="p-4 text-left">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleInspectRestaurant(rest.slug, rest.id)}
                              className="px-3 py-1.5 rounded-lg bg-gold-500/10 hover:bg-gold-500 text-gold-300 hover:text-luxury-950 font-bold border border-gold-500/30 text-xs flex items-center gap-1 transition-all"
                              title="الدخول للوحة إدارة هذا المطعم"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>إدارة</span>
                            </button>

                            <button
                              onClick={() => handleToggleStatus(rest.id, rest.status)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                isActive
                                  ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              }`}
                            >
                              {isActive ? 'إيقاف' : 'تفعيل'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PLANS */}
      {activeTab === 'SUBSCRIPTIONS' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div
              key={p.id}
              className={`p-6 rounded-2xl border flex flex-col justify-between ${
                p.isPopular ? 'bg-luxury-900 border-gold-500/50 shadow-luxury' : 'bg-luxury-900/60 border-luxury-800'
              }`}
            >
              <div>
                {p.isPopular && (
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gold-500 text-luxury-950 mb-2">
                    الأكثر طلباً للمطاعم
                  </span>
                )}
                <h3 className="text-base font-bold text-luxury-50 font-serif">{p.name}</h3>
                <p className="text-xs text-luxury-400 mt-1">{p.description}</p>
                <div className="my-4">
                  <span className="text-2xl font-bold text-gold-400">{formatPrice(p.priceMonthly)}</span>
                  <span className="text-xs text-luxury-400"> / شهرياً</span>
                </div>

                <div className="space-y-2 pt-3 border-t border-luxury-800 text-xs text-luxury-300">
                  <div>✓ حتى {p.maxTables === 999 ? 'غير محدود من' : p.maxTables} طاولة</div>
                  <div>✓ حتى {p.maxCategories === 999 ? 'أقسام غير محدودة' : `${p.maxCategories} أقسام`}</div>
                  <div>✓ حتى {p.maxProducts === 999 ? 'أطباق غير محدودة' : `${p.maxProducts} طبق`}</div>
                  {p.entitlements.map((e) => (
                    <div key={e} className="text-emerald-400 font-medium">✓ ميزة: {e.replace('CAN_', '')}</div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: AUDIT LOGS */}
      {activeTab === 'LOGS' && (
        <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-5 shadow-luxury space-y-3">
          <h3 className="text-sm font-bold text-luxury-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-gold-400" />
            <span>سجل العمليات والتدقيق الأمني المباشر</span>
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-luxury-950 border border-luxury-850 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-luxury-200">{log.actor}</span>
                    <span className="text-[10px] bg-luxury-850 px-2 py-0.5 rounded text-gold-400 font-mono">
                      {log.action}
                    </span>
                  </div>
                  <p className="text-[11px] text-luxury-400 mt-0.5">{log.details}</p>
                </div>
                <span className="text-[10px] text-luxury-500 font-mono">{formatTime(log.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
