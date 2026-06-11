/**
 * Users Service
 * 
 * CRUD operations for user management.
 * Django endpoint base: /api/users/
 */

import { api, type PaginatedResponse } from '../client';
import type { User, UserRole } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface UserFilters {
  search?: string;
  role?: UserRole;
  organization?: string;
  is_active?: string;
  page?: string;
  page_size?: string;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  password_confirm: string;
  role: UserRole;
  organization?: number;
  phone?: string;
  permissions?: string[];
}

export interface UpdateUserRequest {
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: UserRole;
  organization?: number;
  is_active?: boolean;
  permissions?: string[];
  groups?: string[];
}

export interface UserPermissionOption {
  id: string;
  app_label: string;
  codename: string;
  name: string;
}

export interface UpdateCurrentUserDashboardPreferencesRequest {
  home_dashboard_preferences: unknown;
}

export interface UserActivity {
  id: number;
  user_id: number;
  action: string;
  details: string;
  ip_address: string;
  created_at: string;
}

// ============================================================================
// Users Service
// ============================================================================

export const usersService = {
  /**
   * Get current authenticated user profile
   * Django endpoint: GET /api/users/me/
   */
  async getCurrentUser(): Promise<User> {
    const { data } = await api.get<User>('/users/me/');
    return data;
  },

  /**
   * List all users with optional filters
   * Django endpoint: GET /api/users/
   */
  async list(filters?: UserFilters): Promise<PaginatedResponse<User>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<User>>('/users/', params);
    return data;
  },

  /**
   * Get a single user by ID
   * Django endpoint: GET /api/users/:id/
   */
  async get(id: number): Promise<User> {
    const { data } = await api.get<User>(`/users/${id}/`);
    return data;
  },

  /**
   * Create a new user
   * Django endpoint: POST /api/users/
   */
  async create(request: CreateUserRequest): Promise<User> {
    const { data } = await api.post<User>('/users/', request);
    return data;
  },

  /**
   * Update a user
   * Django endpoint: PATCH /api/users/:id/
   */
  async update(id: number, request: UpdateUserRequest): Promise<User> {
    const { data } = await api.patch<User>(`/users/${id}/`, request);
    return data;
  },

  /**
   * Delete a user
   * Django endpoint: DELETE /api/users/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/users/${id}/`);
  },

  /**
   * Activate a user
   * Django endpoint: POST /api/users/:id/activate/
   */
  async activate(id: number): Promise<User> {
    const { data } = await api.post<User>(`/users/${id}/activate/`);
    return data;
  },

  /**
   * Deactivate a user
   * Django endpoint: POST /api/users/:id/deactivate/
   */
  async deactivate(id: number): Promise<User> {
    const { data } = await api.post<User>(`/users/${id}/deactivate/`);
    return data;
  },

  /**
   * Admin reset password
   * Django endpoint: POST /api/users/admin-reset-password/
   */
  async adminResetPassword(userId: number, newPassword: string): Promise<void> {
    await api.post(`/users/admin-reset-password/`, {
      user_id: userId,
      new_password: newPassword,
    });
  },

  /**
   * Get user activity log
   * Django endpoint: GET /api/users/:id/activity/
   */
  async getActivity(id: number): Promise<UserActivity[]> {
    const { data } = await api.get<UserActivity[]>(`/users/${id}/activity/`);
    return data;
  },

  /**
   * List assignable user permissions
   * Django endpoint: GET /api/users/permissions/
   */
  async listPermissions(): Promise<UserPermissionOption[]> {
    const { data } = await api.get<UserPermissionOption[]>('/users/permissions/');
    return data;
  },

  /**
   * List all group names in the catalog
   * Django endpoint: GET /api/users/group_catalog/
   */
  async listGroupCatalog(): Promise<string[]> {
    const { data } = await api.get<string[]>('/users/group_catalog/');
    return data;
  },

  /**
   * Add a group to the catalog
   * Django endpoint: POST /api/users/group_catalog/
   */
  async addGroup(name: string): Promise<void> {
    await api.post('/users/group_catalog/', { name });
  },

  /**
   * Remove a group from the catalog
   * Django endpoint: DELETE /api/users/group_catalog/
   */
  async removeGroup(name: string): Promise<void> {
    const encoded = encodeURIComponent(name);
    await api.delete(`/users/group_catalog/?name=${encoded}`);
  },

  /**
   * Save current user's home dashboard preferences
   * Django endpoint: PATCH /api/users/me/
   */
  async updateCurrentUserDashboardPreferences(
    request: UpdateCurrentUserDashboardPreferencesRequest,
  ): Promise<User> {
    const { data } = await api.patch<User>('/users/me/', request);
    return data;
  },

  /**
   * Resend invitation email
   * Django endpoint: POST /api/users/:id/resend-invitation/
   */
  async resendInvitation(id: number): Promise<void> {
    await api.post(`/users/${id}/resend-invitation/`);
  },

  // --- Granular module permissions ---

  /** Module/action catalog. GET /api/users/module-catalog/ */
  async getModuleCatalog(): Promise<{ modules: Record<string, string[]> }> {
    const { data } = await api.get<{ modules: Record<string, string[]> }>('/users/module-catalog/');
    return data;
  },

  /** Role default permissions. GET /api/users/module-permission-defaults/?role= */
  async getModuleDefaults(role: string): Promise<{ role: string; defaults: Record<string, string[]> }> {
    const { data } = await api.get<{ role: string; defaults: Record<string, string[]> }>(
      `/users/module-permission-defaults/?role=${encodeURIComponent(role)}`,
    );
    return data;
  },

  /** A user's module permissions. GET /api/users/:id/module-permissions/ */
  async getModulePermissions(id: number): Promise<ModulePermissionsResponse> {
    const { data } = await api.get<ModulePermissionsResponse>(`/users/${id}/module-permissions/`);
    return data;
  },

  /** Replace a user's module permissions. PUT /api/users/:id/module-permissions/ */
  async setModulePermissions(
    id: number,
    permissions: ModulePermissionRow[],
  ): Promise<{ user_id: number; effective: Record<string, string[]> }> {
    const { data } = await api.put<{ user_id: number; effective: Record<string, string[]> }>(
      `/users/${id}/module-permissions/`,
      { permissions },
    );
    return data;
  },
};

export interface ModulePermissionRow {
  module: string;
  actions: string[];
  scope?: Record<string, unknown>;
  is_enabled?: boolean;
}

export interface ModulePermissionsResponse {
  user_id: number;
  role: string;
  modules: Record<string, string[]>;
  role_defaults: Record<string, string[]>;
  custom: ModulePermissionRow[];
  effective: Record<string, string[]>;
}

export default usersService;
