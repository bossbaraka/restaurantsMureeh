import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { TenantRole } from '../../types/restaurant';
import { api } from '../../services/api';
import {
  Users,
  UserPlus,
  Shield,
  KeyRound,
  Utensils,
  CreditCard,
  UserCheck,
  Trash2,
  Lock,
  CheckCircle2,
  Sparkles,
  Search,
  Loader2,
} from 'lucide-react';

interface StaffUser {
  id: string;
  restaurantId: string;
  name: string;
  email: string;
  role: TenantRole;
  pin: string;
  status: 'ACTIVE' | 'INACTIVE';
  lastActive?: string;
  assignedZone?: string;
}

export const StaffManagement: React.FC = () => {
  const { currentRestaurant, showToast } = useRestaurant();

  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Form State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<TenantRole>('WAITER');
  const [newPin, setNewPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newZone, setNewZone] = useState('الصالة الرئيسية');

  // Load the real staff directory of this tenant from the API.
  const loadStaff = () => {
    if (!currentRestaurant) return;
    api.getStaff(currentRestaurant.id).then((res) => {
      setIsLoading(false);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر تحميل طاقم العمل', res.error);
        return;
      }
      const list: StaffUser[] = res.data.map((u) => ({
        id: u.id,
        restaurantId: u.restaurantId || currentRestaurant.id,
        name: u.name,
        email: u.email,
        role: u.role as TenantRole,
        pin: '••••',
        status: 'ACTIVE',
        lastActive: 'مسجل بالنظام',
        assignedZone: newZone,
      }));
      setStaffList(list);
    });
  };

  useEffect(() => {
    setIsLoading(true);
    loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.id]);

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRestaurant || !newName.trim()) {
      showToast('error', 'خطأ في الإدخال', 'يرجى إدخال اسم الموظف');
      return;
    }
    if (isSaving) return;
    setIsSaving(true);

    const generatedPin = newPin.trim() || Math.floor(1000 + Math.random() * 9000).toString();
    const emailValue = newEmail.trim().toLowerCase() || `${newName.trim().toLowerCase().replace(/\s+/g, '')}@${currentRestaurant.slug}.com`;
    const isManagerRole = newRole === 'RESTAURANT_MANAGER';
    if (isManagerRole && newPassword.length < 6) {
      showToast('error', 'كلمة مرور المساعد مطلوبة', 'يجب أن لا تقل عن 6 أحرف.');
      setIsSaving(false);
      return;
    }

    const res = await api.createStaff(currentRestaurant.id, {
      name: newName.trim(),
      email: emailValue,
      role: newRole,
      pin: isManagerRole ? undefined : generatedPin,
      password: isManagerRole ? newPassword : `Staff-${generatedPin}!`,
    });
    setIsSaving(false);
    if (!res.success || !res.data) {
      showToast('error', 'تعذر إضافة الموظف', res.error);
      return;
    }
    loadStaff();
    setIsAddModalOpen(false);
    setNewName('');
    setNewEmail('');
    setNewPin('');
    setNewPassword('');
    showToast(
      'success',
      'تم بنجاح',
      isManagerRole
        ? `تمت إضافة المساعد ${newName.trim()} (دخول عبر البريد وكلمة المرور)`
        : `تمت إضافة ${newName.trim()} — رمز PIN: ${generatedPin}`
    );
  };

  const handleDeleteStaff = async (id: string, name: string) => {
    if (!currentRestaurant || !staffList.length) return;
    const managersCount = staffList.filter((s) => s.role === 'RESTAURANT_MANAGER').length;
    const target = staffList.find((s) => s.id === id);
    if (target?.role === 'RESTAURANT_MANAGER' && managersCount <= 1) {
      showToast('warning', 'تنبيه', 'لا يمكن حذف الحساب الإداري الوحيد للمطعم');
      return;
    }
    const res = await api.deleteStaff(currentRestaurant.id, id);
    if (!res.success) {
      showToast('error', 'تعذر حذف الموظف', res.error);
      return;
    }
    loadStaff();
    showToast('info', 'تم الحذف', `تم إيقاف حساب الموظف ${name}`);
  };

  const getRoleBadge = (role: TenantRole) => {
    switch (role) {
      case 'RESTAURANT_MANAGER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gold-500/15 text-gold-400 border border-gold-500/30">
            <Shield className="w-3 h-3" /> مدير المطعم
          </span>
        );
      case 'WAITER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">
            <UserCheck className="w-3 h-3" /> نادل / ويتر
          </span>
        );
      case 'KITCHEN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Utensils className="w-3 h-3" /> شيف المطبخ
          </span>
        );
      case 'CASHIER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CreditCard className="w-3 h-3" /> أمين الصندوق (كاشير)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-luxury-800 text-luxury-300">
            طاقم عمل
          </span>
        );
    }
  };

  const filteredStaff = staffList.filter((s) => {
    if (!currentRestaurant) return false;
    if (s.restaurantId !== currentRestaurant.id) return false;
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || s.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6 animate-fade-in text-luxury-100">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-luxury-900 to-luxury-950 border border-luxury-800 rounded-2xl p-6 relative overflow-hidden shadow-luxury">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-gold-400 text-xs font-bold uppercase tracking-wider mb-1">
              <Users className="w-4 h-4" />
              <span>إدارة طاقم العمل والعمال</span>
            </div>
            <h1 className="text-2xl font-bold font-serif text-luxury-50">حسابات المدراء والعمال للمطعم</h1>
            <p className="text-luxury-400 text-sm mt-1">
              أضف حسابات مخصصة للنادل، الشيف، والكاشير برمز PIN سريع للدخول وإدارة الطلبات المباشرة
            </p>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-luxury-950 font-bold px-5 py-2.5 rounded-xl text-sm transition-all shadow-gold-glow cursor-pointer self-start md:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ إضافة موظف جديد</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-luxury-400" />
          <input
            type="text"
            placeholder="بحث بالاسم أو البريد..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-luxury-900 border border-luxury-800 rounded-xl pr-10 pl-4 py-2.5 text-sm text-luxury-100 placeholder-luxury-500 focus:outline-none focus:border-gold-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1">
          {['ALL', 'RESTAURANT_MANAGER', 'WAITER', 'KITCHEN', 'CASHIER'].map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                roleFilter === r
                  ? 'bg-gold-500 text-luxury-950 font-bold'
                  : 'bg-luxury-900 text-luxury-300 hover:bg-luxury-850'
              }`}
            >
              {r === 'ALL' && 'الكل'}
              {r === 'RESTAURANT_MANAGER' && 'المدراء'}
              {r === 'WAITER' && 'النادل'}
              {r === 'KITCHEN' && 'المطبخ'}
              {r === 'CASHIER' && 'الكاشير'}
            </button>
          ))}
        </div>
      </div>

      {/* Staff Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading && (
          <div className="col-span-full p-10 text-center text-luxury-400 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-gold-400" />
            جارٍ تحميل حسابات طاقم العمل من قاعدة البيانات...
          </div>
        )}
        {!isLoading && filteredStaff.length === 0 && (
          <div className="col-span-full p-10 text-center text-luxury-400 text-sm">
            لا توجد حسابات بعد لهذا المطعم. أضف أول موظف (نادل / شيف / كاشير) من زر «+ إضافة موظف جديد».
          </div>
        )}
        {filteredStaff.map((staff) => (
          <div
            key={staff.id}
            className="bg-luxury-900/80 border border-luxury-800 hover:border-luxury-700 rounded-2xl p-5 transition-all shadow-md relative group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-luxury-800 border border-luxury-700 flex items-center justify-center text-gold-400 font-serif font-bold text-base shadow-inner">
                    {staff.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-luxury-100 text-base">{staff.name}</h3>
                    <p className="text-luxury-400 text-xs">{staff.email}</p>
                  </div>
                </div>

                {staff.role !== 'RESTAURANT_MANAGER' && (
                  <button
                    onClick={() => handleDeleteStaff(staff.id, staff.name)}
                    className="text-luxury-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    title="حذف حساب الموظف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="space-y-2 py-3 border-y border-luxury-800/80 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-luxury-400">الدور والصلاحية:</span>
                  {getRoleBadge(staff.role)}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-luxury-400">منطقة الخدمة:</span>
                  <span className="text-luxury-200 font-medium">{staff.assignedZone || 'العامة'}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-luxury-400">{staff.role === 'RESTAURANT_MANAGER' ? 'الدخول عبر:' : 'رمز المرور (PIN):'}</span>
                  <span className="font-mono bg-luxury-950 px-2.5 py-0.5 rounded border border-luxury-800 text-gold-300 font-bold tracking-widest">
                    {staff.role === 'RESTAURANT_MANAGER' ? 'بريد + كلمة مرور' : staff.pin}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-2 flex items-center justify-between text-xs text-luxury-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {staff.lastActive}
              </span>
              <span className="text-luxury-500">مِيرار #{staff.id.slice(-4)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Add Staff Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-luxury-900 border border-luxury-750 rounded-2xl w-full max-w-md p-6 relative shadow-2xl">
            <h2 className="text-xl font-bold font-serif text-luxury-50 mb-1 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-gold-400" />
              <span>إضافة موظف جديد للمطعم</span>
            </h2>
            <p className="text-luxury-400 text-xs mb-5">
              عين دور الموظف (نادل / شيف / كاشير) مع رمز PIN سريع لتسجيل الدخول
            </p>

            <form onSubmit={handleAddStaff} className="space-y-4">
              <div>
                <label className="block text-xs text-luxury-300 font-medium mb-1.5">اسم الموظف *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: يوسف الخالد"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 focus:outline-none focus:border-gold-500/60"
                />
              </div>

              <div>
                <label className="block text-xs text-luxury-300 font-medium mb-1.5">الدور الوظيفي *</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as TenantRole)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 focus:outline-none focus:border-gold-500/60"
                >
                  <option value="WAITER">نادل / ويتر (تلقي نداءات الطاولات وتقديم الطلبات)</option>
                  <option value="KITCHEN">شيف المطبخ (شاشة تحضير الوجبات KDS)</option>
                  <option value="CASHIER">كاشير (تصفية الحسابات وإغلاق الطاولات)</option>
                  <option value="RESTAURANT_MANAGER">مساعد مدير (صلاحيات كاملة للمطعم)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-luxury-300 font-medium mb-1.5">الصالة أو المكان المخصص</label>
                <input
                  type="text"
                  placeholder="مثال: الصالة الرئيسية (الطاولات 1-20)"
                  value={newZone}
                  onChange={(e) => setNewZone(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 focus:outline-none focus:border-gold-500/60"
                />
              </div>

              {newRole === 'RESTAURANT_MANAGER' ? (
                <div>
                  <label className="block text-xs text-luxury-300 font-medium mb-1.5">كلمة مرور المساعد (تُستخدم للدخول بلوحة التحكم) *</label>
                  <input
                    type="password"
                    minLength={6}
                    placeholder="6 أحرف على الأقل"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono tracking-widest focus:outline-none focus:border-gold-500/60"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-luxury-300 font-medium mb-1.5">رمز الدخول السريع (PIN 4-Digits)</label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="مثال: 5566 (أو اتركه لتوليده تلقائياً)"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono tracking-widest focus:outline-none focus:border-gold-500/60"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-luxury-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-luxury-400 hover:text-luxury-200 hover:bg-luxury-800 transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gold-500 hover:bg-gold-400 text-luxury-950 transition-colors shadow-gold-glow cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isSaving ? 'جاري الحفظ في قاعدة البيانات...' : 'حفظ الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
