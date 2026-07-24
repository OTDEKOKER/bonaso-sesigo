/**
 * Authentication Service
 * 
 * Handles login, logout, password reset, and user session management.
 * Endpoints match your Django backend with Simple JWT.
 */

import { api, setAuthTokens, clearAuthTokens, getRefreshToken } from '../client';
import { isTrainingMode } from '@/lib/training-mode';
import { saveOfflineCredential, offlineLogin } from '@/lib/offline/offline-auth';
import { downloadOfflinePackage } from '@/lib/offline/local-store';
import type { User } from '@/lib/types';

const USERS_BASE_PATH = '/users';


function parseJwtPayload(token: string): { exp?: number } | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded) as { exp?: number };
  } catch {
    return null;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface LoginCredentials {
  email?: string;
  username?: string;
  password: string;
}

export interface JWTTokenResponse {
  access: string;
  refresh: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user?: User;
}

export interface PasswordChangeRequest {
  old_password: string;
  new_password: string;
  confirm_password: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  uid: string;
  token: string;
  new_password: string;
}

export interface AdminResetPasswordRequest {
  user_id: number;
  new_password: string;
}

// ============================================================================
// Auth Service
// ============================================================================

export const authService = {
  /**
   * Login with username/email and password
   * Django endpoint: POST /api/users/request-token/
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    // H1: if the user is logging in from a Training Mode context, ask the
    // backend to stamp a tamper-proof `mode=training` claim on the token so the
    // session is bound to training mode server-side (not just via query param).
    const payload =
      typeof window !== 'undefined' && isTrainingMode()
        ? { ...credentials, mode: 'training' as const }
        : credentials;
    const { data } = await api.post<JWTTokenResponse>(
      `${USERS_BASE_PATH}/request-token/`,
      payload
    );
    setAuthTokens(data.access, data.refresh);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('show_login_disclaimer', '1');
    }

    // Fetch user info after login
    let user: User | undefined;
    try {
      user = await this.getCurrentUser();
    } catch {
      /* profile fetch is best-effort */
    }

    // Offline-first: cache an offline credential and pre-download the offline
    // package so the worker can keep working (and log in) with no internet.
    if (typeof window !== 'undefined') {
      try {
        await saveOfflineCredential(credentials.username, credentials.password, {
          access: data.access,
          refresh: data.refresh,
          profile: (user as unknown as Record<string, unknown>) ?? null,
        });
      } catch {
        /* offline credential is best-effort */
      }
      // Fire-and-forget metadata download (don't block the login UI).
      void downloadOfflinePackage().catch(() => undefined);
    }

    return user ? { ...data, user } : data;
  },

  /**
   * Offline login fallback. When there is no network, verify the password
   * against the locally-stored credential and restore the saved tokens so the
   * worker can continue capturing. Returns the restored profile or null.
   */
  async offlineLogin(credentials: LoginCredentials): Promise<LoginResponse | null> {
    const restored = await offlineLogin(credentials.username, credentials.password);
    if (!restored) return null;
    setAuthTokens(restored.access, restored.refresh);
    return {
      access: restored.access,
      refresh: restored.refresh,
      user: (restored.profile as unknown as User) ?? undefined,
    } as LoginResponse;
  },

  /**
   * Refresh the access token
   * Django endpoint: POST /api/users/token/refresh/
   */
  async refreshToken(): Promise<string> {
    const refresh = getRefreshToken();
    if (!refresh) throw new Error('No refresh token available');
    
    const { data } = await api.post<{ access: string; refresh?: string }>(
      `${USERS_BASE_PATH}/token/refresh/`,
      { refresh }
    );
    // Persist the rotated refresh token (ROTATE_REFRESH_TOKENS blacklists the
    // old one); reusing the old token would 401 on the next refresh.
    setAuthTokens(data.access, data.refresh || refresh);
    return data.access;
  },

  /**
   * Logout current user
   * Django endpoint: POST /api/users/logout/
   */
  async logout(): Promise<void> {
    try {
      await api.post(`${USERS_BASE_PATH}/logout/`, {
        refresh: getRefreshToken(),
      });
    } catch (err) {
      // Backend may not support token blacklist; treat logout as best-effort.
      console.warn("Logout failed on server, clearing local tokens.", err);
    } finally {
      clearAuthTokens();
    }
  },

  /**
   * Get current authenticated user
   * Django endpoint: GET /api/users/me/
   */
  async getCurrentUser(): Promise<User> {
    const { data } = await api.get<User>(`${USERS_BASE_PATH}/me/`);
    return data;
  },

  /**
   * Record acceptance of the mandatory confidentiality notice for the current
   * version. Idempotent server-side; returns the refreshed gate status.
   * Django endpoint: POST /api/users/confidentiality-acknowledgement/
   */
  async acknowledgeConfidentiality(): Promise<{
    required_version: string;
    needs_acknowledgement: boolean;
  }> {
    const { data } = await api.post<{
      required_version: string;
      needs_acknowledgement: boolean;
    }>(`${USERS_BASE_PATH}/confidentiality-acknowledgement/`);
    return data;
  },

  /**
   * Create a new user (registration)
   * Django endpoint: POST /api/users/create-user/
   */
  async createUser(userData: Partial<User> & { password: string }): Promise<User> {
    const { data } = await api.post<User>(
      `${USERS_BASE_PATH}/create-user/`,
      userData
    );
    return data;
  },

  /**
   * Admin reset password for a user
   * Django endpoint: POST /api/users/admin-reset-password/
   */
  async adminResetPassword(request: AdminResetPasswordRequest): Promise<void> {
    await api.post(`${USERS_BASE_PATH}/admin-reset-password/`, request);
  },

  /**
   * Change password for logged in user (via Djoser)
   * Django endpoint: POST /api/manage/users/set_password/
   */
  async changePassword(request: PasswordChangeRequest): Promise<void> {
    await api.post('/manage/users/set_password/', {
      current_password: request.old_password,
      new_password: request.new_password,
      re_new_password: request.confirm_password,
    });
  },

  /**
   * Request password reset email (via Djoser)
   * Django endpoint: POST /api/manage/users/reset_password/
   */
  async requestPasswordReset(request: PasswordResetRequest): Promise<void> {
    await api.post('/manage/users/reset_password/', request);
  },

  /**
   * Confirm password reset with token (via Djoser)
   * Django endpoint: POST /api/manage/users/reset_password_confirm/
   */
  async confirmPasswordReset(request: PasswordResetConfirm): Promise<void> {
    await api.post('/manage/users/reset_password_confirm/', request);
  },

  /**
   * Test connection to backend
   * Django endpoint: GET /api/users/test-connection/
   */
  async testConnection(): Promise<boolean> {
    try {
      await api.get(`${USERS_BASE_PATH}/test-connection/`);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Check if user is authenticated (client-side only)
   */
  isAuthenticated(): boolean {
    if (typeof window === 'undefined') return false;

    const token = localStorage.getItem('access_token');
    if (!token) return false;

    const payload = parseJwtPayload(token);
    if (!payload?.exp) return true;

    const isExpired = payload.exp * 1000 <= Date.now();
    if (isExpired) {
      clearAuthTokens();
      return false;
    }

    return true;
  },
};

export default authService;
