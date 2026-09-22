import React from 'react';
import { RestaurantProvider, useRestaurant } from './context/RestaurantContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ViewSwitcher } from './components/common/ViewSwitcher';
import { CustomerLayout } from './components/customer/CustomerLayout';
import { ManagerLayout } from './components/manager/ManagerLayout';
import { SplitPreviewLayout } from './components/common/SplitPreviewLayout';
import { PlatformAdminPortal } from './components/admin/PlatformAdminPortal';
import { KitchenDisplaySystem } from './components/manager/KitchenDisplaySystem';
import { LiveRestaurantScreen } from './components/manager/LiveRestaurantScreen';
import { SaaSLandingPage } from './components/common/SaaSLandingPage';
import { RestaurantOnboardingModal } from './components/onboarding/RestaurantOnboardingModal';
import { LoginModal } from './components/auth/LoginModal';
import { ToastContainer } from './components/common/Toast';
import { PlatformAppearanceProvider } from './theme/PlatformAppearanceProvider';
import { StickyStackProvider } from './theme/StickyStack';

const AppContent: React.FC = () => {
  const { viewMode, isOnboardingOpen, setIsOnboardingOpen } = useRestaurant();
  const { canAccessView, isLoginModalOpen } = useAuth();

  // APP-LEVEL CUSTOMER THEME WRITER REMOVED (theme single-writer foundation).
  //
  // This component used to call useBrandTheme(...) to paint the tenant palette
  // onto <html> for the WHOLE application. Two problems:
  //
  //   1. It defaulted to the DARK surface (useBrandTheme's default
  //      surfaceMode), so on a light-mode menu it raced CustomerLayout's
  //      mode-aware writer and won whenever it re-ran.
  //   2. It applied restaurant branding to the PLATFORM shell (Manager, KDS,
  //      Admin) — the coupling that makes platform and restaurant appearance
  //      impossible to separate.
  //
  // The customer theme is now applied by CustomerThemeProvider, scoped to the
  // customer menu subtree. Platform surfaces keep their own appearance.

  const safeViewMode = canAccessView(viewMode) || viewMode === 'SAAS_LANDING' ? viewMode : 'CUSTOMER';

  if (isLoginModalOpen) {
    return (
      <div
      className="min-h-screen flex flex-col font-sans selection:bg-[#0072BC]/30 selection:text-[#38BDF8]"
      /* PLATFORM shell surface — follows platform appearance, never the
         restaurant theme. */
      style={{ backgroundColor: 'var(--mureeh-bg)', color: 'var(--mureeh-text)' }}
    >
        <LoginModal />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col font-sans selection:bg-[#0072BC]/30 selection:text-[#38BDF8]"
      /* PLATFORM shell surface — follows platform appearance, never the
         restaurant theme. */
      style={{ backgroundColor: 'var(--mureeh-bg)', color: 'var(--mureeh-text)' }}
    >
      {/* Top Prototype & Multi-Tenant Navigation Bar — hidden on the public SaaS landing page, which renders its own navbar */}
      {safeViewMode !== 'SAAS_LANDING' && <ViewSwitcher />}

      {/* Dynamic View Mode Router */}
      <div className="flex-1">
        {safeViewMode === 'CUSTOMER' && <CustomerLayout />}
        {safeViewMode === 'MANAGER' && <ManagerLayout />}
        {safeViewMode === 'KITCHEN_KDS' && <KitchenDisplaySystem />}
        {safeViewMode === 'LIVE_SCREEN' && <LiveRestaurantScreen />}
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
    <PlatformAppearanceProvider>
      {/* The sticky stack spans BOTH the platform toolbar and the customer
          header, so it must sit above the view router that renders them.
          It measures whichever bands are actually present. */}
      <StickyStackProvider>
        <AuthProvider>
          <RestaurantProvider>
            <AppContent />
          </RestaurantProvider>
        </AuthProvider>
      </StickyStackProvider>
    </PlatformAppearanceProvider>
  );
}
