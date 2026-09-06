import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { RestaurantUser, Restaurant, TenantRole } from '../types/restaurant';
import { api, AUTH_TOKEN_KEY } from '../services/api';

interface AuthContextType {
  currentUser: RestaurantUser | null;
  setCurrentUser: (user: RestaurantUser | null) => void;
  currentManagerRestaurant: Restaurant | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isRestaurantManager: boolean;
  isStaff: boolean;
  failedAttempts: number;
  lockoutRemainingSeconds: number;
  canAccessView: (view: string) => boolean;
  canAccessManagerTab: (tab: string) => boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithPin: (pin: string, role?: TenantRole) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  switchManagerRestaurant: (restaurantId: string) => void;
  isLoginModalOpen: boolean;
  setIsLoginModalOpen: (open: boolean) => void;
}

const ROLE_VIEW_ACCESS: Record<string, string[]> = {
  PLATFORM_ADMIN: ['CUSTOMER', 'MANAGER', 'KITCHEN_KDS', 'PLATFORM_ADMIN', 'SAAS_LANDING', 'SPLIT_PREVIEW', 'LIVE_SCREEN'],
  SUPER_ADMIN: ['CUSTOMER', 'MANAGER', 'KITCHEN_KDS', 'PLATFORM_ADMIN', 'SAAS_LANDING', 'SPLIT_PREVIEW', 'LIVE_SCREEN'],
  RESTAURANT_MANAGER: ['CUSTOMER', 'MANAGER', 'KITCHEN_KDS', 'SAAS_LANDING', 'SPLIT_PREVIEW', 'LIVE_SCREEN'],
  CASHIER: ['CUSTOMER', 'MANAGER', 'LIVE_SCREEN'],
  WAITER: ['CUSTOMER', 'KITCHEN_KDS'],
  KITCHEN: ['CUSTOMER', 'KITCHEN_KDS'],
  STAFF: ['CUSTOMER'],
  GUEST: ['CUSTOMER'],
};

const ROLE_MANAGER_TAB_ACCESS: Record<string, string[]> = {
  PLATFORM_ADMIN: ['OVERVIEW', 'POS', 'ORDERS', 'TABLES', 'QR', 'MENU', 'OFFERS', 'WAITERS', 'STAFF', 'ANALYTICS', 'BRANDING', 'SUBSCRIPTION', 'BRANCHES'],
  SUPER_ADMIN: ['OVERVIEW', 'POS', 'ORDERS', 'TABLES', 'QR', 'MENU', 'OFFERS', 'WAITERS', 'STAFF', 'ANALYTICS', 'BRANDING', 'SUBSCRIPTION', 'BRANCHES'],
  RESTAURANT_MANAGER: ['OVERVIEW', 'POS', 'ORDERS', 'TABLES', 'QR', 'MENU', 'OFFERS', 'WAITERS', 'STAFF', 'ANALYTICS', 'BRANDING', 'SUBSCRIPTION', 'BRANCHES'],
  CASHIER: ['OVERVIEW', 'POS', 'ORDERS', 'TABLES'],
  WAITER: [],
  KITCHEN: ['OVERVIEW', 'ORDERS'],
  STAFF: [],
  GUEST: [],
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SEC = 60;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<RestaurantUser | null>(null);
  const [currentManagerRestaurant, setCurrentManagerRestaurant] = useState<Restaurant | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0);

  // Boot: restore the JWT session exclusively from the real backend (/auth/me).
  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      if (typeof window === 'undefined') return;
      if (!localStorage.getItem(AUTH_TOKEN_KEY)) return;

      const res = await api.getCurrentUser();
      if (isMounted && res.success && res.data) {
        setCurrentUser(res.data.user);
        if (res.data.restaurant) {
          setCurrentManagerRestaurant(res.data.restaurant);
        }
      } else if (isMounted && res.statusCode === 401) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setCurrentUser(null);
        setCurrentManagerRestaurant(null);
      }
    };

    void restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (lockoutRemainingSeconds > 0) {
      const timer = setInterval(() => {
        setLockoutRemainingSeconds((prev) => {
          if (prev <= 1) {
            setFailedAttempts(0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [lockoutRemainingSeconds]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (lockoutRemainingSeconds > 0) {
        return {
          success: false,
          error: `تم قفل محاولات تسجيل الدخول مؤقتاً لأسباب أمنية. يرجى الانتظار ${lockoutRemainingSeconds} ثانية.`,
        };
      }

      const res = await api.login(email.trim().toLowerCase(), password);

      if (res.success && res.data) {
        setFailedAttempts(0);
        setCurrentUser(res.data.user);
        if (res.data.restaurant) {
          setCurrentManagerRestaurant(res.data.restaurant);
        }
        setIsLoginModalOpen(false);
        return { success: true };
      }

      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
        setLockoutRemainingSeconds(LOCKOUT_DURATION_SEC);
        return {
          success: false,
          error: `تم تجاوز الحد الأقصى للمحاولات الخاطئة (${MAX_FAILED_ATTEMPTS}). تم قفل الحساب لمدة ${LOCKOUT_DURATION_SEC} ثانية لحماية النظام.`,
        };
      }
      return {
        success: false,
        error: `${res.error || 'البريد أو كلمة المرور غير صحيحة'} (تبقى لك ${MAX_FAILED_ATTEMPTS - nextAttempts} محاولات)`,
      };
    },
    [failedAttempts, lockoutRemainingSeconds]
  );

  // Staff PIN login — validated against the real DB (hashed PIN per account).
  const loginWithPin = useCallback(
    async (pin: string, role?: TenantRole) => {
      if (lockoutRemainingSeconds > 0) {
        return {
          success: false,
          error: `يرجى الانتظار ${lockoutRemainingSeconds} ثانية قبل إعادة إدخال الرمز.`,
        };
      }

      const res = await api.pinLogin(pin, currentManagerRestaurant?.id || undefined);

      if (res.success && res.data) {
        setFailedAttempts(0);
        setCurrentUser(res.data.user);
        if (res.data.restaurant) {
          setCurrentManagerRestaurant(res.data.restaurant);
        }
        setIsLoginModalOpen(false);
        return { success: true };
      }

      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
        setLockoutRemainingSeconds(LOCKOUT_DURATION_SEC);
      }
      return {
        success: false,
        error: `${res.error || 'رمز PIN غير صحيح. يرجى مراجعة مدير المطعم.'} (تبقى ${Math.max(0, MAX_FAILED_ATTEMPTS - nextAttempts)} محاولات)`,
      };
    },
    [failedAttempts, lockoutRemainingSeconds, currentManagerRestaurant?.id]
  );

  const logout = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    void api.logout();
    setCurrentUser(null);
    setCurrentManagerRestaurant(null);
  }, []);

  // Switch the currently managed tenant (platform admins may inspect any tenant).
  const switchManagerRestaurant = useCallback(
    async (restaurantId: string) => {
      if (!currentUser) return;
      if (currentUser.restaurantId && currentUser.restaurantId !== restaurantId) return;

      if (currentUser.restaurantId === restaurantId && currentManagerRestaurant?.id === restaurantId) {
        setCurrentManagerRestaurant(currentManagerRestaurant);
        return;
      }

      // Platform admins: resolve the requested tenant from the real platform overview.
      if (!currentUser.restaurantId) {
        const res = await api.getPlatformOverview(currentUser);
        const target = res.success
          ? res.data?.restaurants.find((r) => r.id === restaurantId)
          : null;
        if (target) setCurrentManagerRestaurant(target);
      }
    },
    [currentUser, currentManagerRestaurant]
  );

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'PLATFORM_ADMIN';
  // No demo accounts exist on the platform anymore — every account is real.
  const isRestaurantManager = currentUser?.role === 'RESTAURANT_MANAGER' || isSuperAdmin;
  const isStaff = currentUser?.role === 'WAITER' || currentUser?.role === 'KITCHEN' || currentUser?.role === 'CASHIER';
  const isAuthenticated = !!currentUser;

  const canAccessView = useCallback((view: string) => {
    if (!currentUser) return false;
    const allowed = ROLE_VIEW_ACCESS[currentUser.role] || ROLE_VIEW_ACCESS.GUEST;
    return allowed.includes(view);
  }, [currentUser]);

  const canAccessManagerTab = useCallback((tab: string) => {
    if (!currentUser) return false;
    const allowed = ROLE_MANAGER_TAB_ACCESS[currentUser.role] || ROLE_MANAGER_TAB_ACCESS.GUEST;
    return allowed.includes(tab);
  }, [currentUser]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        currentManagerRestaurant,
        isAuthenticated,
        isSuperAdmin,
        isRestaurantManager,
        isStaff,
        failedAttempts,
        lockoutRemainingSeconds,
        canAccessView,
        canAccessManagerTab,
        login,
        loginWithPin,
        logout,
        switchManagerRestaurant,
        isLoginModalOpen,
        setIsLoginModalOpen,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
