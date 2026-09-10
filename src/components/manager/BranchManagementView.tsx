import React, { useEffect, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Branch, RestaurantTable } from '../../types/restaurant';
import { ZONE_LABELS } from '../../services/analytics';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Check,
  X,
  Lock,
  Store,
  Users,
} from 'lucide-react';

const BRANCH_COLORS = ['#D4AF37', '#4ADE80', '#60A5FA', '#F87171', '#C084FC', '#FB923C', '#2DD4BF', '#E879F9'];

export const BranchManagementView: React.FC = () => {
  const { currentRestaurant, branches, tables, hasEntitlement, refreshTenantData, showToast } = useRestaurant();
  const { currentUser } = useAuth();
  const canManage = hasEntitlement('CAN_CREATE_BRANCH');

  const [editing, setEditing] = useState<Branch | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [color, setColor] = useState(BRANCH_COLORS[0]);
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [assignmentBranchId, setAssignmentBranchId] = useState<string | null>(null);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [pendingSave, setPendingSave] = useState(false);
  // Branch ceiling of the tenant's plan (server-enforced; shown as a hint here).
  const [maxBranches, setMaxBranches] = useState<number | null>(null);

  const tenantId = currentRestaurant?.id || '';

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    api.getManagerSubscription(tenantId).then((res) => {
      if (!alive || !res.success || !res.data) return;
      const plan = res.data.plans.find((p) => p.id === res.data.subscription?.planId);
      if (plan) setMaxBranches(plan.maxBranches);
    });
    return () => {
      alive = false;
    };
  }, [tenantId]);
  const branchTables = (branchId: string | null): RestaurantTable[] => {
    const list = branchId ? tables.filter((t) => t.branchId === branchId) : tables.filter((t) => !t.branchId);
    return list.slice().sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0));
  };

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setName('');
    setAddress('');
    setPhone('');
    setColor(BRANCH_COLORS[branches.length % BRANCH_COLORS.length]);
  };

  const startEdit = (branch: Branch) => {
    setEditing(branch);
    setCreating(false);
    setName(branch.name);
    setAddress(branch.address || '');
    setPhone(branch.phone || '');
    setColor(branch.color || BRANCH_COLORS[0]);
  };

  const saveBranch = async () => {
    if (!tenantId || !name.trim()) {
      showToast('warning', 'اسم الفرع مطلوب', 'أدخل اسمًا للفرع قبل الحفظ.');
      return;
    }
    if (!currentUser) return;
    setPendingSave(true);
    const existing = editing || creating ? (editing ? editing : null) : null;
    const branch: Branch = existing
      ? { ...existing, name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined, color }
      : {
          id: `branch-${Date.now()}`,
          restaurantId: tenantId,
          name: name.trim(),
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          color,
          isActive: true,
          createdAt: new Date().toISOString(),
        };
    const res = await api.saveBranch(currentUser, tenantId, branch);
    setPendingSave(false);
    if (res.success) {
      refreshTenantData();
      setCreating(false);
      setEditing(null);
      showToast('success', 'تم حفظ الفرع', branch.name);
    } else {
      showToast('error', 'فشل حفظ الفرع', res.error);
    }
  };

  const removeBranch = async (branch: Branch) => {
    if (!currentUser || !tenantId) return;
    const assigned = branchTables(branch.id).length;
    if (!window.confirm(`حذف فرع «${branch.name}»؟${assigned > 0 ? ` سيتم إلغاء توزيع ${assigned} طاولات.` : ''}`)) return;
    const res = await api.deleteBranch(currentUser, tenantId, branch.id);
    if (res.success) {
      refreshTenantData();
      showToast('success', 'تم حذف الفرع', branch.name);
    } else {
      showToast('error', 'فشل حذف الفرع', res.error);
    }
  };

  const openAssignment = (branchId: string | null) => {
    setAssignmentBranchId(branchId);
    setAssignedIds(
      branchId
        ? tables.filter((t) => t.branchId === branchId).map((t) => t.id)
        : tables.filter((t) => !t.branchId).map((t) => t.id)
    );
    setAssignmentModalOpen(true);
  };

  const confirmAssignment = async () => {
    if (!currentUser || !tenantId) return;
    setPendingSave(true);
    const res = await api.assignTablesToBranch(currentUser, tenantId, assignmentBranchId, assignedIds);
    setPendingSave(false);
    if (res.success) {
      refreshTenantData();
      setAssignmentModalOpen(false);
      showToast('success', 'تم تحديث توزيع الطاولات', `عدد الطاولات الموزعة: ${assignedIds.length}`);
    } else {
      showToast('error', 'فشل التوزيع', res.error);
    }
  };

  if (!canManage) {
    return (
      <div className="p-12 text-center rounded-2xl bg-luxury-900 border border-luxury-800 space-y-3">
        <div className="w-12 h-12 rounded-full bg-gold-500/10 text-gold-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="font-bold text-luxury-100">إدارة الفروع متاحة في باقة المؤسسات</h2>
        <p className="text-xs text-luxury-400 max-w-md mx-auto leading-relaxed">
          إدارة فروع وسلاسل المطاعم المتعددة (توزيع الطاولات، التقارير لكل فرع، ونقاط البيع المستقلة) ضمن باقة Enterprise &amp; Multi-Branch.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-luxury-50 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-gold-400" />
            إدارة الفروع — {currentRestaurant?.name}
          </h2>
          <p className="text-[11px] text-luxury-400 mt-1">
            وزّع طاولاتك على فروع متعددة وافتح لكل فرع شاشة كاشير وتقارير مستقلة.
            {maxBranches !== null && (
              <span className="inline-block mr-2 text-gold-400/90 font-bold">
                ({branches.length} / {maxBranches} فرع)
              </span>
            )}
          </p>
        </div>
        <button
          onClick={startCreate}
          disabled={maxBranches !== null && branches.length >= maxBranches}
          className="flex items-center gap-1.5 bg-gold-500 hover:bg-gold-400 disabled:opacity-40 disabled:cursor-not-allowed text-luxury-950 font-bold px-3.5 py-2 rounded-xl text-xs transition-colors cursor-pointer"
          title={
            maxBranches !== null && branches.length >= maxBranches
              ? `وصلت للحد الأقصى لعدد الفروع في باقتك (${maxBranches})`
              : 'إضافة فرع جديد'
          }
        >
          <Plus className="w-4 h-4" /> فرع جديد
        </button>
      </div>

      {/* Branches grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {branches.map((branch) => {
          const assigned = branchTables(branch.id);
          const occupied = assigned.filter((t) => t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED').length;
          const activeOrders = assigned.reduce((s, t) => s + t.activeOrderIds.length, 0);
          return (
            <div key={branch.id} className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${branch.color || '#D4AF37'}22`, border: `1px solid ${branch.color || '#D4AF37'}55` }}
                  >
                    <Store className="w-5 h-5" style={{ color: branch.color || '#D4AF37' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-luxury-50 text-sm truncate">{branch.name}</h3>
                    {branch.address && (
                      <p className="text-[10px] text-luxury-400 truncate flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" /> {branch.address}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(branch)} className="p-1.5 rounded-lg text-luxury-400 hover:text-gold-300 hover:bg-luxury-850 transition-colors cursor-pointer" title="تعديل">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeBranch(branch)} className="p-1.5 rounded-lg text-luxury-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer" title="حذف">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-luxury-950 rounded-xl p-2">
                  <div className="text-sm font-bold text-luxury-100">{assigned.length}</div>
                  <div className="text-[11px] text-luxury-500 font-bold">طاولة</div>
                </div>
                <div className="bg-luxury-950 rounded-xl p-2">
                  <div className="text-sm font-bold text-amber-300">{occupied}</div>
                  <div className="text-[11px] text-luxury-500 font-bold">مشغولة</div>
                </div>
                <div className="bg-luxury-950 rounded-xl p-2">
                  <div className="text-sm font-bold text-gold-400">{activeOrders}</div>
                  <div className="text-[11px] text-luxury-500 font-bold">فاتورة نشطة</div>
                </div>
              </div>
              <button
                onClick={() => openAssignment(branch.id)}
                className="w-full py-2 rounded-xl bg-luxury-950 border border-luxury-750 text-xs text-luxury-200 hover:border-gold-500/50 transition-colors font-bold cursor-pointer"
              >
                توزيع الطاولات ({assigned.length})
              </button>
            </div>
          );
        })}

        {/* Unassigned group */}
        <div className="rounded-2xl bg-luxury-900/60 border border-dashed border-luxury-700 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-luxury-800 flex items-center justify-center text-luxury-400 shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-luxury-300 text-sm">طاولات غير مصنفة</h3>
              <p className="text-[10px] text-luxury-500">بدون فرع — تظهر في الفرع الرئيسي الافتراضي</p>
            </div>
          </div>
          <div className="text-center py-2">
            <div className="text-2xl font-bold text-luxury-200 font-mono">{branchTables(null).length}</div>
            <div className="text-[10px] text-luxury-500">طاولة</div>
          </div>
          <button
            onClick={() => openAssignment(null)}
            className="w-full py-2 rounded-xl bg-luxury-950 border border-luxury-750 text-xs text-luxury-300 hover:border-gold-500/50 transition-colors font-bold cursor-pointer"
          >
            توزيعها على فرع
          </button>
        </div>
      </div>

      {/* Create / Edit modal */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-luxury-900 border border-luxury-750 rounded-2xl w-full max-w-md shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-luxury-50 text-sm">{editing ? 'تعديل الفرع' : 'فرع جديد'}</h3>
              <button onClick={() => { setCreating(false); setEditing(null); }} className="text-luxury-400 hover:text-luxury-100 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-luxury-400 font-bold block mb-1" htmlFor="branchmanagementview-f1">اسم الفرع *</label>
                <input id="branchmanagementview-f1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: فرع شارع النخيل"
                  className="w-full bg-luxury-950 border border-luxury-750 rounded-xl px-3 py-2 text-sm text-luxury-100 outline-none focus:border-gold-500/60"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-luxury-400 font-bold block mb-1" htmlFor="branchmanagementview-f2">العنوان</label>
                  <input id="branchmanagementview-f2"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="اختياري"
                    className="w-full bg-luxury-950 border border-luxury-750 rounded-xl px-3 py-2 text-sm text-luxury-100 outline-none focus:border-gold-500/60"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-luxury-400 font-bold block mb-1" htmlFor="branchmanagementview-f3">الهاتف</label>
                  <input id="branchmanagementview-f3"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="اختياري"
                    className="w-full bg-luxury-950 border border-luxury-750 rounded-xl px-3 py-2 text-sm text-luxury-100 outline-none focus:border-gold-500/60"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-luxury-400 font-bold block mb-2">لون التمييز</label>
                <div className="flex gap-2">
                  {BRANCH_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform cursor-pointer ${color === c ? 'scale-125 ring-2 ring-white/60' : ''}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={saveBranch}
                disabled={pendingSave}
                className="w-full bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-luxury-950 font-bold py-2.5 rounded-xl text-sm transition-colors cursor-pointer"
              >
                {pendingSave ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديلات' : 'إنشاء الفرع'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table assignment modal */}
      {assignmentModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-luxury-900 border border-luxury-750 rounded-2xl w-full max-w-2xl shadow-2xl p-5 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-luxury-50 text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-gold-400" />
                توزيع الطاولات — {assignmentBranchId ? branches.find((b) => b.id === assignmentBranchId)?.name : 'غير مصنفة'}
              </h3>
              <button onClick={() => setAssignmentModalOpen(false)} className="text-luxury-400 hover:text-luxury-100 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-luxury-400 mb-2">
              <span>محدد: {assignedIds.length} طاولة</span>
              <div className="flex gap-2">
                <button onClick={() => setAssignedIds(tables.map((t) => t.id))} className="text-gold-400 hover:underline cursor-pointer">تحديد الكل</button>
                <button onClick={() => setAssignedIds([])} className="text-luxury-400 hover:underline cursor-pointer">مسح</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pb-2">
              {tables.slice().sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0)).map((t) => {
                const checked = assignedIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-xs cursor-pointer transition-colors ${
                      checked ? 'border-gold-500/60 bg-gold-500/10' : 'border-luxury-750 bg-luxury-950 hover:border-luxury-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAssignedIds((prev) => (checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]))
                      }
                      className="accent-gold-500"
                    />
                    <span className="font-mono font-bold text-luxury-100">طاولة {t.tableNumber}</span>
                    <span className="text-[11px] text-luxury-500 mr-auto">{ZONE_LABELS[t.zone] || t.zone}</span>
                  </label>
                );
              })}
            </div>
            <div className="border-t border-luxury-800 pt-3 flex gap-2">
              <button
                onClick={confirmAssignment}
                disabled={pendingSave}
                className="flex-1 flex items-center justify-center gap-2 bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-luxury-950 font-bold py-2.5 rounded-xl text-sm transition-colors cursor-pointer"
              >
                <Check className="w-4 h-4" /> حفظ التوزيع
              </button>
              <button
                onClick={() => setAssignmentModalOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-luxury-850 text-luxury-300 text-sm hover:text-luxury-100 cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
