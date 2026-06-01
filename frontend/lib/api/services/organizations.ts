/**
 * Organizations Service
 * 
 * CRUD operations for organizations.
 * Django endpoint base: /api/organizations/
 */

import { api, type PaginatedResponse } from '../client';
import type { Organization } from '@/lib/types';
import { canonicalizeOrganizationName } from '@/lib/organization-aliases';
import { mapOrganizationTypeToBackend, normalizeOrganizationType } from '@/lib/organization-hierarchy';

// ============================================================================
// Types
// ============================================================================

export interface OrganizationFilters {
  search?: string;
  parent?: string;
  is_active?: string;
  page?: string;
  page_size?: string;
}

export interface CreateOrganizationRequest {
  name: string;
  code?: string;
  type?: string;
  parent?: number | null;
  parentId?: number | string | null;
  description?: string;
  address?: string;
  email?: string;
  phone?: string;
  contactEmail?: string;
  contactPhone?: string;
  is_active?: boolean;
}

export interface UpdateOrganizationRequest extends Partial<CreateOrganizationRequest> {
  is_active?: boolean;
}

type RawOrganization = {
  id: string | number;
  name: string;
  type: string;
  parent?: string | number | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  description?: string | null;
  is_active?: boolean | null;
  created_at?: string;
  createdAt?: string;
  code?: string;
};

function makeCode(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'ORG';
}

function mapOrganization(org: RawOrganization): Organization {
  return {
    id: String(org.id),
    name: canonicalizeOrganizationName(org.name),
    type: normalizeOrganizationType(org.type) as Organization["type"],
    parentId: org.parent ? String(org.parent) : undefined,
    contactEmail: org.email ?? undefined,
    contactPhone: org.phone ?? undefined,
    address: org.address ?? undefined,
    description: org.description ?? undefined,
    is_active: org.is_active ?? undefined,
    createdAt: org.created_at ?? org.createdAt ?? '',
    // Preserve code if present for internal use.
    code: org.code,
  } as Organization & { code?: string };
}

function mapPaginatedOrganizations(
  data: PaginatedResponse<RawOrganization>,
): PaginatedResponse<Organization> {
  return {
    ...data,
    results: data.results.map(mapOrganization),
  };
}

const LIST_ALL_PAGE_SIZE = '500';

// ============================================================================
// Organizations Service
// ============================================================================

export const organizationsService = {
  /**
   * List all organizations with optional filters
   * Django endpoint: GET /api/organizations/
   */
  async list(filters?: OrganizationFilters): Promise<PaginatedResponse<Organization>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<RawOrganization>>('/organizations/', params);
    return mapPaginatedOrganizations(data);
  },
  /**
   * List all organizations across all pages
   */
  async listAll(filters?: OrganizationFilters): Promise<Organization[]> {
    const results: Organization[] = [];
    let page = filters?.page ? String(filters.page) : "1";
    const baseFilters = { ...(filters || {}) } as Record<string, string>;
    delete baseFilters.page;
    if (!baseFilters.page_size) {
      baseFilters.page_size = LIST_ALL_PAGE_SIZE;
    }

    while (true) {
      const { data } = await api.get<PaginatedResponse<RawOrganization>>('/organizations/', {
        ...baseFilters,
        page,
      });
      const mapped = mapPaginatedOrganizations(data);
      results.push(...mapped.results);
      if (!mapped.next) break;
      try {
        const nextUrl = new URL(mapped.next);
        const nextPage = nextUrl.searchParams.get("page");
        if (!nextPage) break;
        page = nextPage;
      } catch {
        break;
      }
    }
    return results;
  },

  /**
   * Get a single organization by ID
   * Django endpoint: GET /api/organizations/:id/
   */
  async get(id: number): Promise<Organization> {
    const { data } = await api.get<RawOrganization>(`/organizations/${id}/`);
    return mapOrganization(data);
  },

  /**
   * Create a new organization
   * Django endpoint: POST /api/organizations/
   */
  async create(request: CreateOrganizationRequest): Promise<Organization> {
    const payload = {
      name: request.name,
      code: request.code || makeCode(request.name),
      type: mapOrganizationTypeToBackend(request.type),
      parent: request.parent ?? (request.parentId ? Number(request.parentId) : undefined),
      description: request.description,
      address: request.address,
      email: request.email ?? request.contactEmail,
      phone: request.phone ?? request.contactPhone,
      is_active: request.is_active,
    };
    const { data } = await api.post<RawOrganization>('/organizations/', payload);
    return mapOrganization(data);
  },

  /**
   * Update an organization
   * Django endpoint: PATCH /api/organizations/:id/
   */
  async update(id: number, request: UpdateOrganizationRequest): Promise<Organization> {
    const payload = {
      ...request,
      type: mapOrganizationTypeToBackend(request.type),
      parent: request.parent ?? (request.parentId ? Number(request.parentId) : undefined),
      email: request.email ?? request.contactEmail,
      phone: request.phone ?? request.contactPhone,
    };
    delete payload.parentId;
    delete payload.contactEmail;
    delete payload.contactPhone;
    const { data } = await api.patch<RawOrganization>(`/organizations/${id}/`, payload);
    return mapOrganization(data);
  },

  /**
   * Delete an organization
   * Django endpoint: DELETE /api/organizations/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/organizations/${id}/`);
  },

  /**
   * Get organization hierarchy tree
   * Django endpoint: GET /api/organizations/tree/
   */
  async getTree(): Promise<Organization[]> {
    const { data } = await api.get<Organization[]>('/organizations/tree/');
    return data;
  },

  /**
   * Get organizations for dropdown select
   * Django endpoint: GET /api/organizations/choices/
   */
  async getChoices(): Promise<Array<{ id: number; name: string }>> {
    const { data } = await api.get<Array<{ id: number; name: string }>>('/organizations/choices/');
    return data;
  },
};

export default organizationsService;
