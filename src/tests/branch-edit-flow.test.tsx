// @vitest-environment jsdom
/**
 * Branch management — the edit path must UPDATE the branch it opened.
 *
 * Regression guard for the shipped defect: `saveBranch()` called
 * `api.saveBranch` (POST /manager/branches) for BOTH create and edit, so every
 * «تعديل» silently created a duplicate branch and `api.updateBranch`
 * (PUT /manager/branches/:id) was never reached from the UI.
 *
 * Rendered interactively (createRoot + act) so the actual click → save flow is
 * exercised, not just source text.
 */
import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Branch, Restaurant, RestaurantTable } from '../types/restaurant';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const branch: Branch = {
  id: 'branch-1',
  restaurantId: 'rest-1',
  name: 'الفرع الرئيسي',
  address: 'شارع 1',
  phone: '0599000000',
  color: '#D4AF37',
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
};

const table: RestaurantTable = {
  id: 'table-1',
  restaurantId: 'rest-1',
  tableNumber: 1,
  capacity: 4,
  zone: 'MAIN_HALL',
  status: 'AVAILABLE',
  branchId: 'branch-1',
  activeOrderIds: [],
  hasWaiterCall: false,
};

const saveBranch = vi.fn(async () => ({ success: true, data: {} as never, statusCode: 201 }));
const updateBranch = vi.fn(async () => ({ success: true, data: {} as never, statusCode: 200 }));
const getManagerSubscription = vi.fn(async () => ({ success: false, error: 'n/a', statusCode: 500 }));

const ctx = {
  currentRestaurant: { id: 'rest-1', name: 'مطعم الاختبار' } as Partial<Restaurant>,
  branches: [branch],
  tables: [table],
  hasEntitlement: () => true,
  refreshTenantData: vi.fn(),
  showToast: vi.fn(),
};

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useRestaurant: () => ctx };
});

vi.mock(import('../context/AuthContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({
      currentUser: { id: 'user-1', name: 'مدير', role: 'RESTAURANT_MANAGER' },
    }),
  };
});

// Only the three calls the view makes are replaced; every other api method
// (and the class prototype) stays real for the assertions below.
vi.mock(import('../services/api'), async (importOriginal) => {
  const actual = await importOriginal();
  const mocked = Object.create(actual.api) as typeof actual.api;
  mocked.saveBranch = saveBranch as unknown as typeof actual.api.saveBranch;
  mocked.updateBranch = updateBranch as unknown as typeof actual.api.updateBranch;
  mocked.getManagerSubscription =
    getManagerSubscription as unknown as typeof actual.api.getManagerSubscription;
  return { ...actual, api: mocked };
});

const { BranchManagementView } = await import('../components/manager/BranchManagementView');

// ---------------------------------------------------------------------------
// Route-level proof (REAL manager router, stubbed Prisma): the '' the form now
// sends for an emptied field must reach the database as an explicit NULL clear,
// and the edit must stay tenant-scoped. Booted lazily inside the describe below
// so the UI tests above keep their mocked api module.
// ---------------------------------------------------------------------------

const branchUpdateCalls: Array<Record<string, any>> = [];

const branchUsers: Record<string, any> = {
  'user-a': { id: 'user-a', restaurantId: 'rest-1', name: 'مدير', email: 'a@test', role: 'RESTAURANT_MANAGER', status: 'ACTIVE', tokenVersion: 0, restaurant: { status: 'ACTIVE' } },
  'user-b': { id: 'user-b', restaurantId: 'rest-other', name: 'مدير آخر', email: 'b@test', role: 'RESTAURANT_MANAGER', status: 'ACTIVE', tokenVersion: 0, restaurant: { status: 'ACTIVE' } },
};

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    auditLog: { create: async () => ({}) },
    restaurantUser: { findUnique: async ({ where }: any) => branchUsers[where.id] ?? null },
    branch: {
      findUnique: async ({ where }: any) => (where.id === 'branch-1' ? branch : null),
      update: async (args: any) => {
        branchUpdateCalls.push(args);
        return { ...branch, ...args.data };
      },
    },
  },
}));

let container: HTMLDivElement;
let root: Root;

const click = async (el: Element | null | undefined) => {
  expect(el, 'element to click must exist').toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el, 'input to type into must exist').toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const buttonByText = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes(text)
  );

beforeEach(async () => {
  saveBranch.mockClear();
  updateBranch.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BranchManagementView />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('branch management — create vs edit', () => {
  it('edit saves through PUT /manager/branches/:id (never a second POST)', async () => {
    await click(container.querySelector('button[title="تعديل"]'));

    const nameInput = container.querySelector<HTMLInputElement>('#branchmanagementview-f1');
    expect(nameInput?.value).toBe('الفرع الرئيسي');
    await type(nameInput, 'فرع النخيل');
    await click(buttonByText('حفظ التعديلات'));

    expect(saveBranch).not.toHaveBeenCalled();
    expect(updateBranch).toHaveBeenCalledTimes(1);
    const [restaurantId, saved] = updateBranch.mock.calls[0] as unknown as [string, Branch];
    expect(restaurantId).toBe('rest-1');
    // The row that was opened is the row that is updated.
    expect(saved.id).toBe('branch-1');
    expect(saved.name).toBe('فرع النخيل');
  });

  it('edit sends an explicit clear for an emptied address (omitting it would be a no-op)', async () => {
    await click(container.querySelector('button[title="تعديل"]'));

    const addressInput = container.querySelector<HTMLInputElement>('#branchmanagementview-f2');
    expect(addressInput?.value).toBe('شارع 1');
    await type(addressInput, '');
    await click(buttonByText('حفظ التعديلات'));

    const [, saved] = updateBranch.mock.calls[0] as unknown as [string, Branch];
    expect(saved.address).toBe('');
    expect(saved.name).toBe('الفرع الرئيسي');
  });

  it('create still posts a new branch', async () => {
    await click(buttonByText('فرع جديد'));
    await type(container.querySelector<HTMLInputElement>('#branchmanagementview-f1'), 'فرع ثانٍ');
    await click(buttonByText('إنشاء الفرع'));

    expect(updateBranch).not.toHaveBeenCalled();
    expect(saveBranch).toHaveBeenCalledTimes(1);
    const [, , created] = saveBranch.mock.calls[0] as unknown as [unknown, string, Branch];
    expect(created.name).toBe('فرع ثانٍ');
  });

  it('the wired api method really targets PUT /manager/branches/:id with the cleared value', async () => {
    const realApi = (await vi.importActual<typeof import('../services/api')>('../services/api')).api;
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: { branch: { ...branch, address: null } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await realApi.updateBranch('rest-1', { ...branch, address: '' });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/manager\/branches\/branch-1$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toMatchObject({
      restaurantId: 'rest-1',
      name: 'الفرع الرئيسي',
      address: '',
    });
  });
});

describe('branch edit — real route (stubbed Prisma)', () => {
  let base = '';
  let tokenA = '';
  let tokenB = '';
  let close: () => Promise<void> = async () => undefined;

  beforeAll(async () => {
    // Bootable server env, fixed before any server module loads.
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
        ? process.env.JWT_SECRET
        : 'branch-edit-flow-test-secret-min32-chars';
    process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';
    process.env.STORAGE_DRIVER = 'local';
    process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/branch-edit-flow-uploads';
    delete process.env.APP_URL;

    const { default: express } = await import('express');
    const managerRouter = (await import('../../server/routes/manager')).default;
    const { signToken, authenticateToken } = await import('../../server/middleware/auth');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/manager', authenticateToken, managerRouter);

    const server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
    tokenA = signToken(branchUsers['user-a'] as never);
    tokenB = signToken(branchUsers['user-b'] as never);
  }, 30000);

  afterAll(async () => {
    await close();
  });

  const put = (token: string, body: Record<string, unknown>) =>
    fetch(`${base}/api/manager/branches/branch-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  it('writes the edited name and turns the emptied address into an explicit NULL', async () => {
    branchUpdateCalls.length = 0;
    // Exactly what api.saveBranch/updateBranch send for the edited row (the UI
    // model also carries createdAt, which the body deliberately omits).
    const res = await put(tokenA, {
      restaurantId: branch.restaurantId,
      name: 'فرع النخيل',
      address: '',
      phone: branch.phone,
      color: branch.color,
      isActive: branch.isActive,
    });
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(branchUpdateCalls).toHaveLength(1);
    expect(branchUpdateCalls[0].where).toEqual({ id: 'branch-1' }); // update, never create
    expect(branchUpdateCalls[0].data).toMatchObject({
      name: 'فرع النخيل',
      address: null,
      phone: '0599000000',
    });
  });

  it('leaves the address untouched when the key is omitted (unchanged ≠ cleared)', async () => {
    branchUpdateCalls.length = 0;
    const res = await put(tokenA, { restaurantId: 'rest-1', name: 'فرع النخيل' });
    expect(res.status).toBe(200);
    expect(branchUpdateCalls[0].data.address).toBeUndefined();
  });

  it('refuses an edit from another tenant', async () => {
    branchUpdateCalls.length = 0;
    const res = await put(tokenB, { restaurantId: 'rest-other', name: 'فرع مسروق' });
    expect(res.status).toBe(403);
    expect(branchUpdateCalls).toHaveLength(0);
  });
});
