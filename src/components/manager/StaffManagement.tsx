import React, { useState, useEffect, useCallback } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { TenantRole } from '../../types/restaurant';
import { api } from '../../services/api';
import { StepUpModal } from '../auth/StepUpModal';
import {
  Users,
  UserPlus,
  Shield,
  Utensils,
  CreditCard,
  UserCheck,
  Trash2,
  CheckCircle2,
  Search,
  Loader2,
  Edit3,
  AlertTriangle,
  KeyRound,
  PowerOff,
  Power,
} from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';

// ============================================================
// Staff management — 2026-09 employee authentication redesign.
//
//   Managers : email + strong password (no PIN).
//   Staff    : per-tenant USERNAME + 6-digit PIN (no password, no email —
//              the derived `Staff-{PIN}!` pattern is permanently gone).
//
// Creating/editing credentials, changing roles/status and deleting a user
// are step-up protected: the manager re-enters their password first.
// Deactivation (not deletion) is the primary way to remove access.
// ============================================================

interface StaffUser {
  id: string;
  restaurantId: string;
  name: string;
  email: string | null;
  username: string | null;
  role: TenantRole;
  hasPin: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  lastLoginAt?: string | null;
}

/** Client-side mirror of the server's documented weak-PIN policy. */
function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if ('0123456789'.includes(pin)) return true;
  if ('9876543210'.includes(pin)) return true;
  if (/^(\d{2})\1\1$/.test(pin)) return true;
  if (/^(\d{3})\1$/.test(pin)) return true;
  return pin === '112233';
}

/** CSPRNG 6-digit PIN that also satisfies the weak-PIN policy. */
function generateSixDigitPin(): string {
  for (let i = 0; i < 64; i += 1) {
    const n = 100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
    const pin = n.toString();
    if (!isWeakPin(pin)) return pin;
  }
  return '739104'; // astronomically unreachable fallback
}

const SHIFT_ROLES: TenantRole[] = ['WAITER', 'KITCHEN', 'CASHIER', 'STAFF'];

export const StaffManagement: React.FC = () => {
  const { currentRestaurant, showToast } = useRestaurant();
  const { currentUser } = useAuth();

  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffUser | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Step-up state: sensitive actions open the verification modal first.
  const [stepUpAction, setStepUpAction] = useState<string | null>(null);
  const [stepUpLabel, setStepUpLabel] = useState('');
  const [pendingAction, setPendingAction] = useState<((token: string) => Promise<void>) | null>(null);

  // Add/edit staff dialogs: Escape, scroll lock and focus management.
  useDialog({
    isOpen: isAddModalOpen,
    onClose: () => setIsAddModalOpen(false),
  });
  useDialog({ isOpen: !!editingStaff, onClose: () => setEditingStaff(null) });

  // Form State for Add
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<TenantRole>('WAITER');
  const [newPin, setNewPin] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Form State for Edit
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editRole, setEditRole] = useState<TenantRole>('WAITER');
  const [editPin, setEditPin] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editEmail, setEditEmail] = useState('');

  // Load the real staff directory of this tenant from the API.
  const loadStaff = useCallback(async () => {
    if (!currentRestaurant) return;
    setIsLoading(true);
    setLoadError(null);
    const res = await api.getStaff(currentRestaurant.id);
    setIsLoading(false);
    if (!res.success || !res.data) {
      setLoadError(res.error || 'حدث خطأ أثناء الاتصال بالخادم');
      showToast('error', 'تعذر تحميل طاقم العمل', res.error);
      return;
    }
    setLoadError(null);
    const list: StaffUser[] = (res.data as any[]).map((u) => ({
      id: u.id,
      restaurantId: u.restaurantId || currentRestaurant.id,
      name: u.name,
      email: u.email ?? null,
      username: u.username ?? null,
      role: u.role as TenantRole,
      hasPin: !!u.pinHash || !!u.hasPin || u.pin === '••••',
      status: (u.status as StaffUser['status']) || 'ACTIVE',
      lastLoginAt: u.lastLoginAt ?? null,
    }));
    setStaffList(list);
  }, [currentRestaurant, showToast]);

  useEffect(() => {
    setIsLoading(true);
    void loadStaff();
  }, [currentRestaurant?.id, loadStaff]);

  // ------------------------------------------------------------------
  // Step-up orchestration: run a sensitive action behind verification.
  // ------------------------------------------------------------------
  const runWithStepUp = (label: string, action: (token: string) => Promise<void>) => {
    setStepUpLabel(label);
    setPendingAction(() => action);
    setStepUpAction('pending');
  };

  const handleStepUpVerified = async (token: string) => {
    setStepUpAction(null);
    const action = pendingAction;
    setPendingAction(null);
    if (action) await action(token);
  };

  // ------------------------------------------------------------------
  // ADD STAFF
  // ------------------------------------------------------------------
  const submitAddStaff = async (stepUpToken: string) => {
    if (!currentRestaurant || !newName.trim()) return;
    const isManagerRole = newRole === 'RESTAURANT_MANAGER';

    setIsSaving(true);
    const generatedPin = newPin.trim() || generateSixDigitPin();
    const res = await api.createStaff(
      currentRestaurant.id,
      isManagerRole
        ? {
            name: newName.trim(),
            email: newEmail.trim().toLowerCase(),
            password: newPassword,
            role: newRole,
          }
        : {
            name: newName.trim(),
            username: newUsername.trim().toLowerCase(),
            pin: generatedPin,
            role: newRole,
          },
      stepUpToken
    );
    setIsSaving(false);
    if (!res.success || !res.data) {
      showToast('error', 'تعذر إضافة الموظف', res.error);
      return;
    }
    void loadStaff();
    setIsAddModalOpen(false);
    setNewName('');
    setNewEmail('');
    setNewUsername('');
    setNewPin('');
    setNewPassword('');
    showToast(
      'success',
      'تم بنجاح',
      isManagerRole
        ? `تمت إضافة المدير ${newName.trim()} — الدخول عبر البريد وكلمة المرور`
        : `تمت إضافة ${newName.trim()} — اسم المستخدم: ${newUsername.trim().toLowerCase()} — رمز PIN: ${generatedPin}`
    );
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRestaurant || !newName.trim()) {
      showToast('error', 'خطأ في الإدخال', 'يرجى إدخال اسم الموظف');
      return;
    }
    if (isSaving) return;
    const isManagerRole = newRole === 'RESTAURANT_MANAGER';

    if (isManagerRole) {
      if (!newEmail.trim()) {
        showToast('error', 'البريد مطلوب', 'حساب المدير يدخل عبر البريد وكلمة المرور');
        return;
      }
      if (newPassword.length < 8) {
        showToast('error', 'كلمة مرور ضعيفة', 'يجب ألا تقل كلمة مرور المدير عن 8 أحرف.');
        return;
      }
    } else {
      if (!/^[a-zA-Z0-9._-]{2,32}$/.test(newUsername.trim())) {
        showToast('error', 'اسم مستخدم غير صالح', 'من 2 إلى 32 حرفاً: أحرف وأرقام و . _ - فقط');
        return;
      }
      if (newPin.trim() && isWeakPin(newPin.trim())) {
        showToast('error', 'رمز PIN ضعيف', 'اختر رقماً غير متسلسل وغير مكرر (6 أرقام).');
        return;
      }
    }

    runWithStepUp('إضافة موظف جديد', submitAddStaff);
  };

  // ------------------------------------------------------------------
  // EDIT STAFF
  // ------------------------------------------------------------------
  const openEditModal = (staff: StaffUser) => {
    setEditingStaff(staff);
    setEditName(staff.name);
    setEditEmail(staff.email || '');
    setEditUsername(staff.username || '');
    setEditRole(staff.role);
    setEditPin('');
    setEditPassword('');
  };

  const submitSaveEditStaff = async (stepUpToken: string) => {
    if (!editingStaff || !currentRestaurant || !editName.trim()) return;
    const targetWillBeManager = editRole === 'RESTAURANT_MANAGER';

    setIsSaving(true);
    const res = await api.updateStaff(
      currentRestaurant.id,
      editingStaff.id,
      {
        name: editName.trim(),
        role: editRole,
        ...(targetWillBeManager
          ? {
              ...(editEmail.trim() ? { email: editEmail.trim().toLowerCase() } : {}),
              ...(editPassword ? { password: editPassword } : {}),
            }
          : {
              ...(editUsername.trim() ? { username: editUsername.trim().toLowerCase() } : {}),
              ...(editPin.trim() ? { pin: editPin.trim() } : {}),
            }),
      },
      stepUpToken
    );
    setIsSaving(false);
    if (!res.success) {
      showToast('error', 'تعذر تعديل بيانات الموظف', `${res.error || 'لم يتم الحفظ'}. بقيت بياناتك في النموذج.`);
      return;
    }
    await loadStaff();
    setEditingStaff(null);
    showToast('success', 'تم تعديل بيانات الموظف بنجاح', editName.trim());
  };

  const handleSaveEditStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff || !editName.trim()) return;
    const targetWillBeManager = editRole === 'RESTAURANT_MANAGER';

    if (!targetWillBeManager && editPin.trim() && isWeakPin(editPin.trim())) {
      showToast('error', 'رمز PIN ضعيف', 'اختر رقماً غير متسلسل وغير مكرر (6 أرقام).');
      return;
    }
    if (targetWillBeManager && editPassword && editPassword.length < 8) {
      showToast('error', 'كلمة مرور ضعيفة', 'يجب ألا تقل كلمة مرور المدير عن 8 أحرف.');
      return;
    }
    if (!targetWillBeManager && !editUsername.trim() && !editingStaff.username) {
      showToast('error', 'اسم مستخدم مطلوب', 'عيّن اسم مستخدم للموظف قبل الحفظ.');
      return;
    }

    runWithStepUp('تعديل بيانات ودور الموظف', submitSaveEditStaff);
  };

  // ------------------------------------------------------------------
  // DEACTIVATE / REACTIVATE (primary access-removal path)
  // ------------------------------------------------------------------
  const submitToggleStatus = async (staff: StaffUser, token: string) => {
    if (!currentRestaurant) return;
    const nextStatus = staff.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const res = await api.updateStaff(
      currentRestaurant.id,
      staff.id,
      { status: nextStatus },
      token
    );
    if (!res.success) {
      showToast('error', 'تعذر تغيير حالة الموظف', res.error);
      return;
    }
    void loadStaff();
    showToast(
      nextStatus === 'ACTIVE' ? 'success' : 'info',
      nextStatus === 'ACTIVE' ? 'تم تنشيط الحساب' : 'تم إيقاف الحساب',
      nextStatus === 'ACTIVE'
        ? `${staff.name} يستطيع تسجيل الدخول مجدداً`
        : `${staff.name} لن يستطيع الدخول، وجلساته الحالية أُبطلت فوراً`
    );
  };

  const handleToggleStatus = (staff: StaffUser) => {
    runWithStepUp(
      staff.status === 'ACTIVE' ? 'إيقاف حساب موظف' : 'تنشيط حساب موظف',
      (token) => submitToggleStatus(staff, token)
    );
  };

  // ------------------------------------------------------------------
  // DELETE (exceptional — prefer deactivation)
  // ------------------------------------------------------------------
  const submitDeleteStaff = async (staff: StaffUser, token: string) => {
    if (!currentRestaurant) return;
    const res = await api.deleteStaff(currentRestaurant.id, staff.id, token);
    if (!res.success) {
      showToast('error', 'تعذر حذف الموظف', res.error);
      return;
    }
    void loadStaff();
    showToast('info', 'تم الحذف', `تم حذف حساب ${staff.name} نهائياً (التاريخ المحاسبي محفوظ)`);
  };

  const handleDeleteStaff = (staff: StaffUser) => {
    if (!currentRestaurant || !staffList.length) return;
    const managersCount = staffList.filter(
      (s) => s.role === 'RESTAURANT_MANAGER' && s.status === 'ACTIVE'
    ).length;
    if (staff.role === 'RESTAURANT_MANAGER' && managersCount <= 1) {
      showToast('warning', 'تنبيه', 'لا يمكن حذف الحساب الإداري الوحيد النشط للمطعم');
      return;
    }
    runWithStepUp('حذف حساب موظف نهائياً', (token) => submitDeleteStaff(staff, token));
  };

  const getRoleBadge = (role: TenantRole) => {
    switch (role) {
      case 'RESTAURANT_MANAGER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gold-500/15 text-gold-400 border border-gold-500/30">
            <Shield className="w-3 h-3" /> مدير / مشرف
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
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      s.name.toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.username || '').toLowerCase().includes(q);
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
              <span>إدارة طاقم العمل والموظفين</span>
            </div>
            <h1 className="text-2xl font-bold font-serif text-luxury-50">إضافة وتعديل وإيقاف مستخدمي المطعم</h1>
            <p className="text-luxury-400 text-sm mt-1">
              المديرون يدخلون بالبريد وكلمة المرور · الموظفون يدخلون برمز المطعم + اسم المستخدم + PIN من 6 أرقام
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
          <input aria-label="بحث بالاسم أو اسم المستخدم..."
            type="text"
            placeholder="بحث بالاسم أو اسم المستخدم..."
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
          <>
            {/* Skeletons preserve the grid's structure while the directory loads. */}
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-luxury-900/80 border border-luxury-800 rounded-2xl p-5 animate-pulse" aria-hidden="true">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-luxury-800" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-2/3 rounded bg-luxury-800" />
                    <div className="h-2.5 w-1/2 rounded bg-luxury-850" />
                  </div>
                </div>
                <div className="h-7 rounded-lg bg-luxury-850" />
              </div>
            ))}
            <span className="sr-only" role="status">جارٍ تحميل حسابات طاقم العمل…</span>
          </>
        )}
        {!isLoading && loadError && (
          <div className="col-span-full p-8 text-center rounded-2xl bg-red-500/5 border border-red-500/20">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-bold text-red-300">تعذر تحميل طاقم العمل</p>
            <p className="text-xs text-luxury-400 mt-1">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadStaff()}
              className="mt-4 px-4 py-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 border border-luxury-750 text-luxury-100 text-xs font-bold transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {!isLoading && !loadError && filteredStaff.length === 0 && (
          <div className="col-span-full p-10 text-center rounded-2xl bg-luxury-900/50 border border-luxury-800">
            <Users className="w-8 h-8 text-gold-400/60 mx-auto mb-2" />
            <p className="text-sm font-bold text-luxury-200">
              {searchQuery || roleFilter !== 'ALL' ? 'لا توجد نتائج مطابقة للبحث' : 'لا يوجد طاقم عمل بعد'}
            </p>
            <p className="text-xs text-luxury-400 mt-1">
              {searchQuery || roleFilter !== 'ALL'
                ? 'جرّب تعديل كلمات البحث أو الفلتر المحدد.'
                : 'أضف أول موظف (نادل / شيف / كاشير) من زر «+ إضافة موظف جديد».'}
            </p>
          </div>
        )}
        {filteredStaff.map((staff) => (
          <div
            key={staff.id}
            className={`bg-luxury-900/80 border rounded-2xl p-5 transition-all shadow-md relative group flex flex-col justify-between ${
              staff.status === 'ACTIVE'
                ? 'border-luxury-800 hover:border-luxury-700'
                : 'border-red-500/30 opacity-80'
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-luxury-800 border border-luxury-700 flex items-center justify-center text-gold-400 font-serif font-bold text-base shadow-inner">
                    {staff.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-luxury-100 text-base">{staff.name}</h3>
                    <p className="text-luxury-400 text-xs font-mono" dir="ltr">
                      {staff.role === 'RESTAURANT_MANAGER' ? staff.email : `@${staff.username || '—'} · ${currentRestaurant?.slug ?? ''}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {/* Toggle Status Button */}
                  <button
                    onClick={() => handleToggleStatus(staff)}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                      staff.status === 'ACTIVE'
                        ? 'text-luxury-400 hover:text-amber-400 hover:bg-amber-500/10'
                        : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                    }`}
                    title={staff.status === 'ACTIVE' ? 'إيقاف الحساب (يفصل جلساته فوراً)' : 'إعادة تنشيط الحساب'}
                  >
                    {staff.status === 'ACTIVE' ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                  </button>

                  {/* Edit Staff Button */}
                  <button
                    onClick={() => openEditModal(staff)}
                    className="text-luxury-400 hover:text-gold-400 p-1.5 rounded-lg hover:bg-luxury-800 transition-colors cursor-pointer"
                    title="تعديل بيانات الموظف والدور"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  {/* Delete Staff Button (exceptional) */}
                  {staff.role !== 'RESTAURANT_MANAGER' && (
                    <button
                      onClick={() => handleDeleteStaff(staff)}
                      className="text-luxury-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
                      title="حذف نهائي (استخدم الإيقاف بدلاً منه عند الإمكان)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2 py-3 border-y border-luxury-800/80 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-luxury-400">الدور والصلاحية:</span>
                  {getRoleBadge(staff.role)}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-luxury-400">طريقة الدخول:</span>
                  <span className="font-mono bg-luxury-950 px-2.5 py-0.5 rounded border border-luxury-800 text-gold-300 font-bold">
                    {staff.role === 'RESTAURANT_MANAGER'
                      ? 'بريد + كلمة مرور'
                      : staff.status === 'ACTIVE'
                        ? 'رمز مطعم + مستخدم + PIN'
                        : 'موقوف'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-luxury-400">الحالة:</span>
                  <span
                    className={`inline-flex items-center gap-1.5 font-bold ${
                      staff.status === 'ACTIVE' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${staff.status === 'ACTIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    {staff.status === 'ACTIVE' ? 'نشط' : 'موقوف'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-2 flex items-center justify-between text-xs text-luxury-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-luxury-500" />
                {staff.lastLoginAt
                  ? `آخر دخول: ${new Date(staff.lastLoginAt).toLocaleDateString('ar')}`
                  : 'لم يسجل الدخول بعد'}
              </span>
              <span className="text-luxury-500">MUREEH #{staff.id.slice(-4)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Add Staff Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-add-title"
            className="bg-luxury-900 border border-luxury-750 rounded-2xl w-full max-w-md p-6 relative shadow-2xl my-4"
            dir="rtl"
          >
            <h2 id="staff-add-title" className="text-xl font-bold font-serif text-luxury-50 mb-1 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-gold-400" />
              <span>إضافة موظف جديد للمطعم</span>
            </h2>
            <p className="text-luxury-400 text-xs mb-5">
              عيّن الدور وبيانات الدخول — المديرون بالبريد وكلمة المرور، والموظفون باسم مستخدم ورمز PIN من 6 أرقام
            </p>

            <form onSubmit={handleAddStaff} className="space-y-4">
              <div>
                <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f1">اسم الموظف *</label>
                <input id="staffmanagement-f1"
                  type="text"
                  required
                  placeholder="مثال: يوسف الخالد"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 focus:outline-none focus:border-gold-500/60"
                />
              </div>

              <div>
                <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f2">الدور الوظيفي *</label>
                <select id="staffmanagement-f2"
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

              {newRole === 'RESTAURANT_MANAGER' ? (
                <>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f4a">البريد الإلكتروني (للدخول) *</label>
                    <input id="staffmanagement-f4a"
                      type="email"
                      dir="ltr"
                      required
                      placeholder="manager@your-restaurant.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono focus:outline-none focus:border-gold-500/60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f4">كلمة مرور قوية (8 أحرف فأكثر) *</label>
                    <input id="staffmanagement-f4"
                      type="password"
                      minLength={8}
                      required
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono tracking-widest focus:outline-none focus:border-gold-500/60"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f5a">اسم المستخدم (للدخول) *</label>
                    <input id="staffmanagement-f5a"
                      type="text"
                      dir="ltr"
                      required
                      minLength={2}
                      maxLength={32}
                      placeholder="مثال: ahmad"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono focus:outline-none focus:border-gold-500/60"
                    />
                    <p className="text-[10px] text-luxury-500 mt-1">
                      فريد داخل المطعم — يستخدمه الموظف مع رمز المطعم ورمز PIN.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f5">رمز PIN (6 أرقام)</label>
                    <input id="staffmanagement-f5"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      placeholder="اتركه فارغاً لتوليد رمز آمن تلقائياً"
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono tracking-widest focus:outline-none focus:border-gold-500/60"
                    />
                    <p className="text-[10px] text-luxury-500 mt-1">
                      يُعرض مرة واحدة بعد الحفظ — يُمنع الأرقام المتسلسلة والمكررة.
                    </p>
                  </div>
                </>
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
                  {isSaving ? 'جاري الحفظ...' : 'حفظ الموظف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-edit-title"
            className="bg-luxury-900 border border-luxury-750 rounded-2xl w-full max-w-md p-6 relative shadow-2xl my-4"
            dir="rtl"
          >
            <h2 id="staff-edit-title" className="text-xl font-bold font-serif text-luxury-50 mb-1 flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-gold-400" />
              <span>تعديل بيانات الموظف ({editingStaff.name})</span>
            </h2>
            <p className="text-luxury-400 text-xs mb-5">
              تعديل الدور أو بيانات الدخول يتطلب تأكيد هويتك (كلمة المرور للمدير)
            </p>

            <form onSubmit={handleSaveEditStaff} className="space-y-4">
              <div>
                <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f6">اسم الموظف *</label>
                <input id="staffmanagement-f6"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 focus:outline-none focus:border-gold-500/60"
                />
              </div>

              <div>
                <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f8">الدور الوظيفي *</label>
                <select id="staffmanagement-f8"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as TenantRole)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 focus:outline-none focus:border-gold-500/60"
                >
                  <option value="WAITER">نادل / ويتر (تلقي نداءات الطاولات وتقديم الطلبات)</option>
                  <option value="KITCHEN">شيف المطبخ (شاشة تحضير الوجبات KDS)</option>
                  <option value="CASHIER">كاشير (تصفية الحسابات وإغلاق الطاولات)</option>
                  <option value="RESTAURANT_MANAGER">مساعد مدير (صلاحيات كاملة للمطعم)</option>
                </select>
              </div>

              {editRole === 'RESTAURANT_MANAGER' ? (
                <>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f7">البريد الإلكتروني</label>
                    <input id="staffmanagement-f7"
                      type="email"
                      dir="ltr"
                      placeholder="manager@your-restaurant.com"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono focus:outline-none focus:border-gold-500/60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f10p">كلمة مرور جديدة (اختياري)</label>
                    <input id="staffmanagement-f10p"
                      type="password"
                      minLength={8}
                      placeholder="اتركها فارغة للإبقاء على الحالية"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono tracking-widest focus:outline-none focus:border-gold-500/60"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f10u">اسم المستخدم</label>
                    <input id="staffmanagement-f10u"
                      type="text"
                      dir="ltr"
                      minLength={2}
                      maxLength={32}
                      placeholder="مثال: ahmad"
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono focus:outline-none focus:border-gold-500/60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-luxury-300 font-medium mb-1.5" htmlFor="staffmanagement-f10">إعادة إصدار رمز PIN (6 أرقام)</label>
                    <input id="staffmanagement-f10"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      placeholder="اتركه فارغاً للإبقاء على الرمز الحالي"
                      value={editPin}
                      onChange={(e) => setEditPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-4 py-2.5 text-sm text-luxury-100 font-mono tracking-widest focus:outline-none focus:border-gold-500/60"
                    />
                    <p className="text-[10px] text-luxury-500 mt-1 flex items-center gap-1">
                      <KeyRound className="w-3 h-3" />
                      إعادة الإصدار تُبطل جلسات الموظف الحالية فوراً وتُظهر الرمز مرة واحدة.
                    </p>
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-luxury-800">
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-luxury-400 hover:text-luxury-200 hover:bg-luxury-800 transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gold-500 hover:bg-gold-400 text-luxury-950 transition-colors shadow-gold-glow cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Step-up verification for sensitive staff operations */}
      <StepUpModal
        isOpen={stepUpAction === 'pending'}
        actionLabel={stepUpLabel}
        onCancel={() => {
          setStepUpAction(null);
          setPendingAction(null);
        }}
        onVerified={(token) => void handleStepUpVerified(token)}
      />
    </div>
  );
};
