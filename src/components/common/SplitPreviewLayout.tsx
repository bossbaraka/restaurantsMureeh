import React from 'react';
import { CustomerLayout } from '../customer/CustomerLayout';
import { ManagerLayout } from '../manager/ManagerLayout';
import { useRestaurant } from '../../context/RestaurantContext';
import { Smartphone, LayoutDashboard, Sparkles, Zap } from 'lucide-react';

export const SplitPreviewLayout: React.FC = () => {
  const { activeTableId } = useRestaurant();

  return (
    <div className="min-h-screen bg-[#07080A] text-luxury-50 flex flex-col" dir="rtl">
      {/* Banner info */}
      <div className="bg-luxury-900 border-b border-luxury-800 px-6 py-2.5 flex items-center justify-between text-xs text-luxury-300">
        <div className="flex items-center gap-2 font-semibold text-gold-300">
          <Zap className="w-4 h-4 text-gold-400" />
          <span>العرض المزدوج المتزامن في الوقت الحقيقي (Live Dual Synchronization)</span>
        </div>
        <span className="text-[11px] text-luxury-400">
          اطلب من هاتف العميل (اليمين) وراقب المطبخ والمدير (اليسار) يتحدثان فوراً بدون تحديث الصفحة!
        </span>
      </div>

      {/* Split Columns */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-0 overflow-hidden">
        {/* Customer Mobile Mockup Column (Left / Right depending on RTL) */}
        <div className="xl:col-span-5 bg-black/60 p-4 sm:p-6 flex flex-col items-center justify-start border-l border-luxury-800 overflow-y-auto max-h-[calc(100vh-100px)]">
          <div className="w-full max-w-sm bg-luxury-950 rounded-[2.5rem] border-4 border-luxury-750 shadow-2xl overflow-hidden relative flex flex-col min-h-[780px]">
            {/* Phone Speaker Notch */}
            <div className="w-32 h-4 bg-luxury-850 rounded-b-xl mx-auto absolute top-0 left-1/2 -translate-x-1/2 z-40" />

            {/* Simulated Mobile App Container */}
            <div className="flex-1 overflow-y-auto">
              <CustomerLayout />
            </div>
          </div>
        </div>

        {/* Manager Dashboard Column */}
        <div className="xl:col-span-7 bg-luxury-950 overflow-y-auto max-h-[calc(100vh-100px)]">
          <ManagerLayout />
        </div>
      </div>
    </div>
  );
};
