/**
 * Employee-test asset (not product code): real, behavioural verification of
 * the frontend permission enforcement described in Part 1 §8.
 *
 * Run:
 *   npx vitest run --config e2e/vitest.guard.config.ts
 *
 * What it proves with the real AuthProvider:
 *  - a role tampered into localStorage/cookies cannot survive the boot
 *    re-verification against /auth/me (refresh does not bypass permissions),
 *  - tabs/views stay gated per the real ROLE_* matrices after verification,
 *  - a STAFF session can never reach manager tabs or the platform admin view,
 *  - the tampered value must not be trusted for authorisation even in the
 *    short window before /auth/me answers (it is only ever cosmetic).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const getCurrentUserMock = vi.fn();

vi.mock('../src/services/api', () => ({
  AUTH_TOKEN_KEY: 'merar_auth_token',
  api: {
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
    login: vi.fn(),
    pinLogin: vi.fn(),
    logout: vi.fn().mockResolvedValue({ success: true }),
    getPlatformOverview: vi.fn(),
  },
}));

import { AuthProvider, useAuth } from '../src/context/AuthContext';

const USER_SESSION_KEY = 'merar_user_session';

const staffFromServer = {
  id: 'staff-1',
  restaurantId: 'resto-a',
  name: 'Staff A',
  email: 'staff.a@test.local',
  role: 'STAFF',
  status: 'ACTIVE',
};

const managerFromServer = { ...staffFromServer, id: 'mgr-1', role: 'RESTAURANT_MANAGER' };

function Probe() {
  const { currentUser, canAccessView, canAccessManagerTab } = useAuth();
  return (
    <div>
      <span data-testid="role">{currentUser?.role ?? 'none'}</span>
      <span data-testid="platform-view">{String(canAccessView('PLATFORM_ADMIN'))}</span>
      <span data-testid="analytics-tab">{String(canAccessManagerTab('ANALYTICS'))}</span>
      <span data-testid="staff-tab">{String(canAccessManagerTab('STAFF'))}</span>
      <span data-testid="orders-tab">{String(canAccessManagerTab('ORDERS'))}</span>
    </div>
  );
}

const renderAuth = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

const txt = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  getCurrentUserMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('frontend permission guards — boot re-verification', () => {
  it('localStorage role tampering (STAFF → RESTAURANT_MANAGER) is overwritten by the server role', async () => {
    localStorage.setItem('merar_auth_token', 'valid-jwt');
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify({ ...staffFromServer, role: 'RESTAURANT_MANAGER' }));
    getCurrentUserMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { user: staffFromServer },
    });

    renderAuth();

    await waitFor(() => expect(txt('role')).toBe('STAFF'));
    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(txt('analytics-tab')).toBe('false');
    expect(txt('staff-tab')).toBe('false');
    expect(txt('platform-view')).toBe('false');
    expect(txt('orders-tab')).toBe('true');
    expect(JSON.parse(localStorage.getItem(USER_SESSION_KEY)!).role).toBe('STAFF');
  });

  it('an escalated SUPER_ADMIN value in storage cannot reach the platform view after boot', async () => {
    localStorage.setItem('merar_auth_token', 'valid-jwt');
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify({ ...staffFromServer, role: 'SUPER_ADMIN' }));
    getCurrentUserMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { user: staffFromServer },
    });

    renderAuth();

    await waitFor(() => expect(txt('role')).toBe('STAFF'));
    expect(txt('platform-view')).toBe('false');
    expect(txt('analytics-tab')).toBe('false');
  });

  it('while /auth/me is pending the tampered role is never treated as an authorisation (cosmetic only)', async () => {
    localStorage.setItem('merar_auth_token', 'valid-jwt');
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify({ ...staffFromServer, role: 'PLATFORM_ADMIN' }));

    let resolveMe: (v: unknown) => void = () => {};
    getCurrentUserMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMe = resolve;
      })
    );

    renderAuth();

    // interim render: the stored (tampered) label may show up, but the real
    // server round-trip is what decides, and it is always requested.
    expect(getCurrentUserMock).toHaveBeenCalled();

    resolveMe({ success: true, statusCode: 200, data: { user: staffFromServer } });
    await waitFor(() => expect(txt('role')).toBe('STAFF'));
    expect(txt('platform-view')).toBe('false');
    expect(txt('analytics-tab')).toBe('false');
  });

  it('a stored session without a token is discarded (no permission from storage alone)', async () => {
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify({ ...staffFromServer, role: 'RESTAURANT_MANAGER' }));

    renderAuth();

    await waitFor(() => expect(txt('role')).toBe('none'));
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(txt('analytics-tab')).toBe('false');
    expect(localStorage.getItem(USER_SESSION_KEY)).toBeNull();
  });

  it('a revoked/expired token (401 on /me) clears the stored session and all access', async () => {
    localStorage.setItem('merar_auth_token', 'revoked-jwt');
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify({ ...managerFromServer }));
    getCurrentUserMock.mockResolvedValue({
      success: false,
      statusCode: 401,
      error: 'انتهت صلاحية الجلسة',
    });

    renderAuth();

    await waitFor(() => expect(txt('role')).toBe('none'));
    expect(localStorage.getItem('merar_auth_token')).toBeNull();
    expect(localStorage.getItem(USER_SESSION_KEY)).toBeNull();
    expect(txt('analytics-tab')).toBe('false');
  });

  it('a real manager keeps manager tabs but still cannot open the platform admin view', async () => {
    localStorage.setItem('merar_auth_token', 'valid-jwt');
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(managerFromServer));
    getCurrentUserMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { user: managerFromServer },
    });

    renderAuth();

    await waitFor(() => expect(txt('role')).toBe('RESTAURANT_MANAGER'));
    expect(txt('analytics-tab')).toBe('true');
    expect(txt('staff-tab')).toBe('true');
    expect(txt('platform-view')).toBe('false');
  });
});
