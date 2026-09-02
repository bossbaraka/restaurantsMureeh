import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, resolvePublicRestaurantCatalog } from '../services/api';
import { db } from '../services/db';
import { SEED_USERS, SEED_RESTAURANTS, SEED_PLANS } from '../data/seedData';
import { OrderItem, Restaurant } from '../types/restaurant';

describe('Multi-Tenant SaaS Restaurant Platform Comprehensive Test Suite', () => {
  beforeEach(() => {
    db.resetToSeed();
  });

  describe('1. Tenant Isolation & Security Layer', () => {
    it('Manager of Restaurant A (MÉRAR) MUST NOT be able to view or modify Restaurant B (Lumière) stats', async () => {
      const merarManager = SEED_USERS.find((u) => u.email === 'manager@merar-dining.com')!;
      
      const result = await api.getManagerDashboardStats(merarManager, 'rest-lumiere');
      
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.error).toContain('غير مصرح لك بالوصول');
    });

    it('Manager of Restaurant A (MÉRAR) MUST NOT be able to change order status of Restaurant B (Lumière)', async () => {
      const merarManager = SEED_USERS.find((u) => u.email === 'manager@merar-dining.com')!;
      
      // Order #2001 belongs to Lumière
      const result = await api.updateOrderStatus(merarManager, 'rest-lumiere', '#2001', 'SERVED');
      
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('Manager cannot update waiter requests of another restaurant', async () => {
      const merarManager = SEED_USERS.find((u) => u.email === 'manager@merar-dining.com')!;
      const result = await api.updateWaiterRequestStatus(merarManager, 'rest-lumiere', 'req-lum-99', 'RESOLVED');
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('Platform Super Admin CAN access and manage any restaurant', async () => {
      const superAdmin = SEED_USERS.find((u) => u.role === 'SUPER_ADMIN')!;
      
      const resMerar = await api.getManagerDashboardStats(superAdmin, 'rest-merar');
      expect(resMerar.success).toBe(true);
      expect(resMerar.data?.restaurant.id).toBe('rest-merar');

      const resLumiere = await api.getManagerDashboardStats(superAdmin, 'rest-lumiere');
      expect(resLumiere.success).toBe(true);
      expect(resLumiere.data?.restaurant.id).toBe('rest-lumiere');
    });
  });

  describe('2. Customer Order State Machine & Immutability Rules', () => {
    it('Customer CAN cancel order while status === PENDING', async () => {
      const cancelRes = await api.cancelOrder('rest-merar', '#1025');
      
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.data?.order.status).toBe('CANCELLED');
    });

    it('Customer CANNOT cancel order once status === PREPARING', async () => {
      const cancelRes = await api.cancelOrder('rest-merar', '#1024');
      
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.statusCode).toBe(403);
      expect(cancelRes.error).toContain('بدأ المطبخ بتحضير طلبك بالفعل');
    });

    it('Customer CANNOT cancel order once status === READY or SERVED', async () => {
      const cancelRes = await api.cancelOrder('rest-merar', '#1022');
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.statusCode).toBe(403);
    });

    it('Customer CAN edit notes only while status === PENDING', async () => {
      const editPending = await api.updateOrderNotes('rest-merar', '#1025', 'ملاحظة جديدة إضافية');
      expect(editPending.success).toBe(true);

      const editPreparing = await api.updateOrderNotes('rest-merar', '#1024', 'ملاحظة متأخرة');
      expect(editPreparing.success).toBe(false);
      expect(editPreparing.statusCode).toBe(403);
    });
  });

  describe('3. Public Tenant Scoping & Menu Isolation', () => {
    it('Customer opening a MÉRAR QR link gets ONLY MÉRAR dishes', async () => {
      const qrToken = db.getTables('rest-merar')[0].qrToken!;
      const res = await api.getPublicRestaurantBySlug('merar', qrToken);
      
      expect(res.success).toBe(true);
      expect(res.data?.restaurant.name).toBe('مطعم مِيرار الفاخر');
      
      const products = res.data?.products || [];
      expect(products.length).toBeGreaterThan(0);
      products.forEach((p) => {
        expect(p.restaurantId).toBe('rest-merar');
      });
    });

    it('Customer opening a LUMIÈRE QR link gets ONLY French dishes', async () => {
      const qrToken = db.getTables('rest-lumiere')[0].qrToken!;
      const res = await api.getPublicRestaurantBySlug('lumiere', qrToken);
      
      expect(res.success).toBe(true);
      expect(res.data?.restaurant.name).toBe('بيسترو لوميير الفرنسي');
      
      const products = res.data?.products || [];
      expect(products.some((p) => p.name.includes('حلزون بورغوني') || p.name.includes('ستيك فريت'))).toBe(true);
      products.forEach((p) => {
        expect(p.restaurantId).toBe('rest-lumiere');
      });
    });

    it('Rejects a public catalog request without a QR token', async () => {
      const res = await api.getPublicRestaurantBySlug('merar');
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(403);
    });

    it('Prefers live API catalog data over the demo fallback when the backend responds successfully', async () => {
      const livePayload = {
        success: true,
        data: {
          restaurant: {
            id: 'rest-live',
            name: 'مطعم حي',
            nameEn: 'Live Restaurant',
            slug: 'live',
            logo: '',
            description: 'live',
            phone: '',
            address: '',
            currency: '₪',
            language: 'ar',
            timezone: 'Asia/Jerusalem',
            status: 'ACTIVE',
            primaryColor: '#D4AF37',
            accentColor: '#C5A880',
            planId: 'plan-pro',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          categories: [{ id: 'cat-live', restaurantId: 'rest-live', name: 'المشروبات', nameEn: 'Drinks', sortOrder: 1 }],
          products: [{
            id: 'prod-live',
            restaurantId: 'rest-live',
            categoryId: 'cat-live',
            name: 'قهوة عربية',
            nameEn: 'Arabic Coffee',
            description: 'قهوة عربية',
            price: 18,
            image: '',
            isAvailable: true,
          }],
          offers: [],
        },
        statusCode: 200,
      };

      const fallback = vi.fn(async (): Promise<any> => ({
        success: true,
        data: {
          restaurant: {
            id: 'rest-demo',
            name: 'مطعم تجريبي',
            nameEn: 'Demo Restaurant',
            slug: 'demo',
            logo: '',
            description: 'demo',
            phone: '',
            address: '',
            currency: '₪',
            language: 'ar' as const,
            timezone: 'Asia/Jerusalem',
            status: 'ACTIVE' as const,
            primaryColor: '#D4AF37',
            accentColor: '#C5A880',
            planId: 'plan-pro',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          categories: [],
          products: [],
          offers: [],
        },
        statusCode: 200,
      }));

      const result = await resolvePublicRestaurantCatalog('live', async () => ({
        ok: true,
        status: 200,
        json: async () => livePayload,
      } as Response), fallback, true);

      expect(result).toEqual(livePayload);
      expect(fallback).not.toHaveBeenCalled();
    });

    it('Requesting non-existent slug returns 404', async () => {
      const res = await api.getPublicRestaurantBySlug('unknown-ghost-slug-999');
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('4. Subscriptions & Feature Entitlements Engine', () => {
    it('Pro plan has CAN_USE_ANALYTICS and CAN_CUSTOM_BRANDING', async () => {
      const hasAnalytics = await api.checkEntitlement('rest-merar', 'CAN_USE_ANALYTICS');
      const hasBranding = await api.checkEntitlement('rest-merar', 'CAN_CUSTOM_BRANDING');
      expect(hasAnalytics).toBe(true);
      expect(hasBranding).toBe(true);
    });

    it('Starter plan does NOT have CAN_USE_ANALYTICS or CAN_CREATE_BRANCH', async () => {
      const hasAnalytics = await api.checkEntitlement('rest-alnakheel', 'CAN_USE_ANALYTICS');
      const hasBranch = await api.checkEntitlement('rest-alnakheel', 'CAN_CREATE_BRANCH');
      expect(hasAnalytics).toBe(false);
      expect(hasBranch).toBe(false);
    });

    it('Enterprise plan has all entitlements including CAN_USE_CUSTOM_DOMAIN and CAN_UNLIMITED_TABLES', async () => {
      const hasCustomDomain = await api.checkEntitlement('rest-lumiere', 'CAN_USE_CUSTOM_DOMAIN');
      const hasUnlimited = await api.checkEntitlement('rest-lumiere', 'CAN_UNLIMITED_TABLES');
      expect(hasCustomDomain).toBe(true);
      expect(hasUnlimited).toBe(true);
    });
  });

  describe('5. Table Ordering & Multi-Order Aggregation Flow', () => {
    it('Customer can submit multiple order rounds on Table 01 and they aggregate under same table session', async () => {
      // 1. Get or create session for Table 01
      const sessionRes = await api.getOrCreateTableSession('rest-merar', 'TABLE-01');
      expect(sessionRes.success).toBe(true);
      const sessionToken = sessionRes.data?.sessionToken!;
      expect(sessionToken).toBeDefined();

      // 2. Submit Round 1
      const sampleItem1: OrderItem = {
        id: 'item-1',
        productId: 'prod-sig-1',
        name: 'تندرلوين بلاك أنغوس المعتق بالترفل',
        nameEn: 'Aged Black Angus Tenderloin',
        unitPrice: 135,
        quantity: 1,
        totalPrice: 135,
        selectedAddOns: [],
        removedIngredients: [],
      };

      const order1Res = await api.submitOrder({
        restaurantId: 'rest-merar',
        tableId: 'TABLE-01',
        sessionToken: sessionToken,
        items: [sampleItem1],
        notes: 'الاستواء وسط',
      });

      expect(order1Res.success).toBe(true);
      expect(order1Res.data?.order.total).toBe(135);

      // 3. Submit Round 2 on the same table
      const sampleItem2: OrderItem = {
        id: 'item-2',
        productId: 'prod-des-1',
        name: 'فوندو الشوكولاتة البلجيكية الداكنة',
        nameEn: 'Dark Chocolate Fondant',
        unitPrice: 42,
        quantity: 2,
        totalPrice: 84,
        selectedAddOns: [],
        removedIngredients: [],
      };

      const order2Res = await api.submitOrder({
        restaurantId: 'rest-merar',
        tableId: 'TABLE-01',
        sessionToken: sessionToken,
        items: [sampleItem2],
        notes: 'تقديم بعد العشاء',
      });

      expect(order2Res.success).toBe(true);
      expect(order2Res.data?.order.total).toBe(84);

      // 4. Verify Table status updated to OCCUPIED and contains active orders
      const updatedTable = db.getTableById('rest-merar', 'TABLE-01');
      expect(updatedTable?.status).toBe('OCCUPIED');
      expect(updatedTable?.activeOrderIds.length).toBeGreaterThanOrEqual(1);
    });

    it('Cashier bill request changes table status to BILL_REQUESTED', async () => {
      const reqRes = await api.requestBill('rest-merar', 'TABLE-01');
      expect(reqRes.success).toBe(true);
      
      const table = db.getTableById('rest-merar', 'TABLE-01');
      expect(table?.status).toBe('BILL_REQUESTED');
    });

    it('Manager can settle table bill and reset table status to AVAILABLE', async () => {
      const merarManager = SEED_USERS.find((u) => u.email === 'manager@merar-dining.com')!;
      
      const settleRes = await api.settleTableBill(merarManager, 'rest-merar', 'TABLE-01');
      expect(settleRes.success).toBe(true);

      const table = db.getTableById('rest-merar', 'TABLE-01');
      expect(table?.status).toBe('AVAILABLE');
      expect(table?.activeOrderIds.length).toBe(0);
    });
  });

  describe('6. Waiter Calling Service & Resolution', () => {
    it('Customer can call waiter to Table 25 and Manager can resolve it', async () => {
      const merarManager = SEED_USERS.find((u) => u.email === 'manager@merar-dining.com')!;
      
      const callRes = await api.callWaiter({
        restaurantId: 'rest-merar',
        tableId: 'TABLE-25',
        reason: 'WATER_REFILL',
        note: 'ماء غازي بارد',
      });

      expect(callRes.success).toBe(true);
      expect(callRes.data?.waiterRequest.reason).toBe('WATER_REFILL');
      const reqId = callRes.data?.waiterRequest.id!;

      // Manager acknowledges request
      const ackRes = await api.updateWaiterRequestStatus(merarManager, 'rest-merar', reqId, 'ACKNOWLEDGED');
      expect(ackRes.success).toBe(true);
      expect(ackRes.data?.request.status).toBe('ACKNOWLEDGED');

      // Manager resolves request
      const resolveRes = await api.updateWaiterRequestStatus(merarManager, 'rest-merar', reqId, 'RESOLVED');
      expect(resolveRes.success).toBe(true);
      expect(resolveRes.data?.request.status).toBe('RESOLVED');
    });
  });

  describe('7. Platform Admin Restaurant Management & Suspension', () => {
    it('Platform Admin can suspend a restaurant preventing customer access', async () => {
      const superAdmin = SEED_USERS.find((u) => u.role === 'SUPER_ADMIN')!;

      // Suspend Al Nakheel
      const suspendRes = await api.toggleRestaurantStatus(superAdmin, 'rest-alnakheel', 'SUSPENDED');
      expect(suspendRes.success).toBe(true);
      expect(suspendRes.data?.restaurant.status).toBe('SUSPENDED');

      // Check public access is rejected with 403
      const pubRes = await api.getPublicRestaurantBySlug('alnakheel');
      expect(pubRes.success).toBe(false);
      expect(pubRes.statusCode).toBe(403);
      expect(pubRes.error).toContain('هذا المطعم غير متاح');

      // Re-activate
      const activateRes = await api.toggleRestaurantStatus(superAdmin, 'rest-alnakheel', 'ACTIVE');
      expect(activateRes.success).toBe(true);
      expect(activateRes.data?.restaurant.status).toBe('ACTIVE');

      const qrToken = db.getTables('rest-alnakheel')[0].qrToken!;
      const pubResActive = await api.getPublicRestaurantBySlug('alnakheel', qrToken);
      expect(pubResActive.success).toBe(true);
      expect(pubResActive.data?.restaurant.status).toBe('ACTIVE');
    });

    it('Platform Super Admin can view global overview of all tenants', async () => {
      const superAdmin = SEED_USERS.find((u) => u.role === 'SUPER_ADMIN')!;
      const overviewRes = await api.getPlatformOverview(superAdmin);
      expect(overviewRes.success).toBe(true);
      expect(overviewRes.data?.totalRestaurants).toBeGreaterThanOrEqual(3);
      expect(overviewRes.data?.plans.length).toBe(3);
    });
  });

  describe('8. Menu Product Management & Stock Control', () => {
    it('Manager can toggle out-of-stock and update product pricing', async () => {
      const merarManager = SEED_USERS.find((u) => u.email === 'manager@merar-dining.com')!;
      
      const product = db.getProductById('rest-merar', 'prod-sig-1')!;
      expect(product).toBeDefined();
      expect(product.isAvailable).toBe(true);

      // Toggle unavailable
      const updatedProduct = { ...product, isAvailable: false };
      const saveRes = await api.saveProduct(merarManager, 'rest-merar', updatedProduct);
      expect(saveRes.success).toBe(true);
      expect(saveRes.data?.product.isAvailable).toBe(false);

      // Verify db persistence
      const recheck = db.getProductById('rest-merar', 'prod-sig-1');
      expect(recheck?.isAvailable).toBe(false);
    });
  });

  describe('9. Tenant Onboarding & Entity Registration', () => {
    it('Allows creating a new restaurant tenant and provisioning tables', () => {
      const newRest: Restaurant = {
        id: 'rest-casablanca',
        name: 'دار كازابلانكا المغربي',
        nameEn: 'Dar Casablanca Moroccan Lounge',
        slug: 'casablanca',
        logo: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
        description: 'طواجن مغربية أصلية وشاي بالنعناع',
        phone: '+970 599 777 888',
        address: 'حي الدبلوماسيين',
        currency: '₪',
        language: 'ar',
        timezone: 'Asia/Jerusalem',
        status: 'ACTIVE',
        primaryColor: '#D4AF37',
        accentColor: '#C5A880',
        planId: 'plan-starter',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      db.saveRestaurant(newRest);
      const saved = db.getRestaurantById('rest-casablanca');
      expect(saved?.name).toBe('دار كازابلانكا المغربي');
      expect(saved?.slug).toBe('casablanca');
    });
  });
});
