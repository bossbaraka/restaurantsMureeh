import React from 'react';
import { RestaurantProvider, useRestaurant } from './context/RestaurantContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ViewSwitcher } from './components/common/ViewSwitcher';
import { CustomerLayout } from './components/customer/CustomerLayout';
import { ManagerLayout } from './components/manager/ManagerLayout';
import { SplitPreviewLayout } from './components/common/SplitPreviewLayout';
import { PlatformAdminPortal } from './components/admin/PlatformAdminPortal';
import { KitchenDisplaySystem } from './components/manager/KitchenDisplaySystem';
import { SaaSLandingPage } from './components/common/SaaSLandingPage';
import { RestaurantOnboardingModal } from './components/onboarding/RestaurantOnboardingModal';
import { LoginModal } from './components/auth/LoginModal';
import { ToastContainer } from './components/common/Toast';

const AppContent: React.FC = () => {
  const { viewMode, isOnboardingOpen, setIsOnboardingOpen } = useRestaurant();
  const { canAccessView, isLoginModalOpen } = useAuth();

  const safeViewMode = canAccessView(viewMode) ? viewMode : 'CUSTOMER';

  if (isLoginModalOpen) {
    return (
      <div className="min-h-screen bg-[#0A0B0D] text-luxury-50 flex flex-col font-sans selection:bg-gold-500/20 selection:text-gold-300">
        <LoginModal />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0B0D] text-luxury-50 flex flex-col font-sans selection:bg-gold-500/20 selection:text-gold-300">
      {/* Top Prototype & Multi-Tenant Navigation Bar */}
      <ViewSwitcher />

      {/* Dynamic View Mode Router */}
      <div className="flex-1">
        {safeViewMode === 'CUSTOMER' && <CustomerLayout />}
        {safeViewMode === 'MANAGER' && <ManagerLayout />}
        {safeViewMode === 'KITCHEN_KDS' && <KitchenDisplaySystem />}
        {safeViewMode === 'SAAS_LANDING' && <SaaSLandingPage />}
        {safeViewMode === 'PLATFORM_ADMIN' && <PlatformAdminPortal />}
        {safeViewMode === 'SPLIT_PREVIEW' && <SplitPreviewLayout />}
      </div>

      {/* Onboarding Wizard Modal */}
      <RestaurantOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
      />

      {/* Manager / Admin Login Modal */}
      <LoginModal />

      {/* Global Toast Notification System */}
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <RestaurantProvider>
        <AppContent />
      </RestaurantProvider>
    </AuthProvider>
  );
}
