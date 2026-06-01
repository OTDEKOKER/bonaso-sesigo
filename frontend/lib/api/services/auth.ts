/**
 * Authentication Service
 * 
 * Handles login, logout, password reset, and user session management.
 * Endpoints match your Django backend with Simple JWT.
 */

import { api, setAuthTokens, clearAuthTokens, getRefreshToken } from '../client';
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
    const { data } = await api.post<JWTTokenResponse>(
      `${USERS_BASE_PATH}/request-token/`,
      credentials
    );
    setAuthTokens(data.access, data.refresh);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('show_login_disclaimer', '1');
    }
    
    // Fetch user info after login
    try {
      const user = await this.getCurrentUser();
      return { ...data, user };
    } catch {
      return data;
    }
  },

  /**
   * Refresh the access token
   * Django endpoint: POST /api/users/token/refresh/
   */
  async refreshToken(): Promise<string> {
    const refresh = getRefreshToken();
    if (!refresh) throw new Error('No refresh token available');
    
    const { data } = await api.post<{ access: string }>(
      `${USERS_BASE_PATH}/token/refresh/`,
      { refresh }
    );
    setAuthTokens(data.access, refresh);
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
