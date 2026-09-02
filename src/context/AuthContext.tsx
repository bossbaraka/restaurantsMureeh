import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { RestaurantUser, Restaurant, TenantRole } from '../types/restaurant';
import { api } from '../services/api';
import { db } from '../services/db';

interface AuthContextType {
  currentUser: RestaurantUser | null;
  currentManagerRestaurant: Restaurant | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isDemoAccount: boolean;
  isRestaurantManager: boolean;
  isStaff: boolean;
  failedAttempts: number;
  lockoutRemainingSeconds: number;
  canAccessView: (view: string) => boolean;
  canAccessManagerTab: (tab: string) => boolean;
  login: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  loginWithPin: (pin: string, role?: TenantRole) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  switchManagerRestaurant: (restaurantId: string) => void;
  isLoginModalOpen: boolean;
  setIsLoginModalOpen: (open: boolean) => void;
}

const ROLE_VIEW_ACCESS: Record<string, string[]> = {
  PLATFORM_ADMIN: ['CUSTOMER', 'MANAGER', 'KITCHEN_KDS', 'PLATFORM_ADMIN', 'SAAS_LANDING', 'SPLIT_PREVIEW'],
  SUPER_ADMIN: ['CUSTOMER', 'MANAGER', 'KITCHEN_KDS', 'PLATFORM_ADMIN', 'SAAS_LANDING', 'SPLIT_PREVIEW'],
  RESTAURANT_MANAGER: ['CUSTOMER', 'MANAGER', 'KITCHEN_KDS', 'SAAS_LANDING', 'SPLIT_PREVIEW'],
  CASHIER: ['CUSTOMER', 'MANAGER'],
  WAITER: ['CUSTOMER', 'KITCHEN_KDS'],
  KITCHEN: ['CUSTOMER', 'KITCHEN_KDS'],
  STAFF: ['CUSTOMER'],
  GUEST: ['CUSTOMER'],
};

const ROLE_MANAGER_TAB_ACCESS: Record<string, string[]> = {
  PLATFORM_ADMIN: ['OVERVIEW', 'ORDERS', 'TABLES', 'QR', 'MENU', 'OFFERS', 'WAITERS', 'STAFF', 'ANALYTICS', 'BRANDING', 'SUBSCRIPTION'],
  SUPER_ADMIN: ['OVERVIEW', 'ORDERS', 'TABLES', 'QR', 'MENU', 'OFFERS', 'WAITERS', 'STAFF', 'ANALYTICS', 'BRANDING', 'SUBSCRIPTION'],
  RESTAURANT_MANAGER: ['OVERVIEW', 'ORDERS', 'TABLES', 'QR', 'MENU', 'OFFERS', 'WAITERS', 'STAFF', 'ANALYTICS', 'BRANDING', 'SUBSCRIPTION'],
  CASHIER: ['OVERVIEW', 'TABLES', 'ORDERS'],
  WAITER: [],
  KITCHEN: ['OVERVIEW', 'ORDERS'],
  STAFF: [],
  GUEST: [],
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'saas_auth_user_v3';
const TOKEN_STORAGE_KEY = 'merar_auth_token';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SEC = 60;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<RestaurantUser | null>(() => {
    if (typeof window !== 'undefined') {
      return null;
    }
    return null;
  });

  const [currentManagerRestaurant, setCurrentManagerRestaurant] = useState<Restaurant | null>(() => {
    if (currentUser?.restaurantId) {
      return db.getRestaurantById(currentUser.restaurantId);
    }
    return db.getRestaurantById('rest-merar');
  });

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0);

  // Lockout countdown timer
  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      if (typeof window === 'undefined' || !localStorage.getItem(TOKEN_STORAGE_KEY)) return;

      const res = await api.getCurrentUser();
      if (isMounted && res.success && res.data) {
        setCurrentUser(res.data.user);
        setCurrentManagerRestaurant(res.data.restaurant);
      } else if (isMounted) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(TOKEN_STORAGE_KEY);
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

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
      if (currentUser.restaurantId) {
        setCurrentManagerRestaurant(db.getRestaurantById(currentUser.restaurantId));
      } else {
        setCurrentManagerRestaurant(db.getRestaurantById('rest-merar'));
      }
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setCurrentManagerRestaurant(null);
    }
  }, [currentUser]);

  // Robust Password Login with Rate-Limiting Protection
  const login = useCallback(
    async (email: string, password = 'password') => {
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
        if (res.data.token) localStorage.setItem(TOKEN_STORAGE_KEY, res.data.token);
        if (res.data.restaurant) {
          setCurrentManagerRestaurant(res.data.restaurant);
        }
        setIsLoginModalOpen(false);
        return { success: true };
      } else {
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
      }
    },
    [failedAttempts, lockoutRemainingSeconds]
  );

  // Fast & Secure Staff PIN Login (Waiters, Kitchen Chefs, Cashiers)
  const loginWithPin = useCallback(
    async (pin: string, role: TenantRole = 'WAITER') => {
      if (lockoutRemainingSeconds > 0) {
        return {
          success: false,
          error: `يرجى الانتظار ${lockoutRemainingSeconds} ثانية قبل إعادة إدخال الرمز.`,
        };
      }

      // Pre-configured staff PINs or manager
      const pinMap: Record<string, { email: string; name: string; role: TenantRole }> = {
        '1234': { email: 'manager@merar-dining.com', name: 'عمر القاسم', role: 'RESTAURANT_MANAGER' },
        '4455': { email: 'waiter1@merar-dining.com', name: 'كريم المنصور', role: 'WAITER' },
        '7788': { email: 'waiter2@merar-dining.com', name: 'طارق الدوسري', role: 'WAITER' },
        '9900': { email: 'chef@merar-dining.com', name: 'الشيف أنطوان', role: 'KITCHEN' },
        '1122': { email: 'cashier@merar-dining.com', name: 'سارة عبد الله', role: 'CASHIER' },
      };

      const matchedStaff = pinMap[pin];
      if (matchedStaff) {
        setFailedAttempts(0);
        const staffUser: RestaurantUser = {
          id: `user-staff-${pin}`,
          restaurantId: 'rest-merar',
          name: matchedStaff.name,
          email: matchedStaff.email,
          role: matchedStaff.role,
          createdAt: new Date().toISOString(),
        };
        setCurrentUser(staffUser);
        setCurrentManagerRestaurant(db.getRestaurantById('rest-merar'));
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
        error: `رمز PIN غير صحيح. يرجى مراجعة مدير المطعم. (تبقى ${Math.max(0, MAX_FAILED_ATTEMPTS - nextAttempts)} محاولات)`,
      };
    },
    [failedAttempts, lockoutRemainingSeconds]
  );

  const logout = useCallback(() => {
    setCurrentUser(null);
    setCurrentManagerRestaurant(null);
  }, []);

  const switchManagerRestaurant = useCallback((restaurantId: string) => {
    const target = db.getRestaurantById(restaurantId);
    if (target && currentUser) {
      const updatedUser: RestaurantUser = {
        ...currentUser,
        restaurantId: currentUser.role === 'SUPER_ADMIN' ? null : restaurantId,
      };
      setCurrentUser(updatedUser);
      setCurrentManagerRestaurant(target);
    }
  }, [currentUser]);

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'PLATFORM_ADMIN';
  const isDemoAccount = currentUser?.email.toLowerCase() === 'demo.manager@merar-promo.com';
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
        currentManagerRestaurant,
        isAuthenticated,
        isSuperAdmin,
        isDemoAccount,
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
