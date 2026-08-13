/**
 * Grants Service
 *
 * Grant / financial accounting. Django endpoint base: /api/grants/
 * The backend enforces project + org scope and deny-by-default access; this is
 * a thin typed client.
 */
import { api, type PaginatedResponse } from '../client';

export interface GrantFinancials {
  awarded: string;
  budgeted: string;
  disbursed: string;
  spent: string;
  remaining: string;
  cash_on_hand?: string;
  burn_pct: number | null;
}

export interface Grant {
  id: number;
  project: number;
  project_name?: string;
  organization: number;
  organization_name?: string;
  coordinator?: number | null;
  coordinator_name?: string | null;
  funder?: number | null;
  funder_name?: string | null;
  code: string;
  title: string;
  currency: string;
  total_amount: string;
  start_date: string | null;
  end_date: string | null;
  status: 'draft' | 'active' | 'suspended' | 'closed';
  notes: string;
  created_at: string;
  updated_at: string;
  financials: GrantFinancials;
}

export interface GrantBudgetLine {
  id: number;
  grant: number;
  category: string;
  description: string;
  budgeted_amount: string;
}

export interface GrantDisbursement {
  id: number;
  grant: number;
  date: string;
  tranche: number | null;
  amount: string;
  reference: string;
  notes: string;
}

export interface GrantExpenditure {
  id: number;
  grant: number;
  budget_line: number | null;
  date: string;
  category: string;
  amount: string;
  description: string;
  supporting_document?: string | null;
}

export interface GrantDetail extends Grant {
  budget_lines: GrantBudgetLine[];
  disbursements: GrantDisbursement[];
  expenditures: GrantExpenditure[];
}

export interface GrantOrgSummaryRow {
  organization_id: number;
  organization_name: string;
  awarded: string;
  disbursed: string;
  spent: string;
  remaining: string;
  burn_pct: number | null;
}

export interface GrantSummary {
  organizations: GrantOrgSummaryRow[];
  grand_total: {
    awarded: string;
    disbursed: string;
    spent: string;
    remaining: string;
    burn_pct: number | null;
    organization_count: number;
  };
}

export interface GrantQuarterRow {
  organization_id: number;
  organization_name: string;
  awarded: string;
  quarters: Record<string, string>;
  fy_total: string;
  burn_pct: number | null;
}

export interface GrantCoordinatorGroup extends GrantQuarterRow {
  members: GrantQuarterRow[];
}

export interface GrantQuarterly {
  fiscal_year: number;
  available_fiscal_years: number[];
  quarters: string[];
  coordinators: GrantCoordinatorGroup[];
  ungrouped: GrantQuarterRow[];
  grand_total: {
    awarded: string;
    quarters: Record<string, string>;
    fy_total: string;
    burn_pct: number | null;
  };
}

export interface GrantFilters {
  project?: string | number;
  organization?: string | number;
  coordinator?: string | number;
  funder?: string | number;
  status?: string;
  search?: string;
  page?: string | number;
  page_size?: string | number;
}

export interface CreateGrantRequest {
  project: number;
  organization: number;
  coordinator?: number | null;
  funder?: number | null;
  code?: string;
  title?: string;
  currency?: string;
  total_amount: string | number;
  start_date?: string | null;
  end_date?: string | null;
  status?: string;
  notes?: string;
}

// api.get/post/... resolve to an ApiResponse wrapper ({ data, ... }); every
// service unwraps `.data` before returning the body. (Bug fix 2026-08-12: the
// grants page read fields off the wrapper → KPIs stuck on skeletons.)
export const grantsService = {
  list: async (filters: GrantFilters = {}) =>
    (await api.get<PaginatedResponse<Grant> | Grant[]>('/grants/', filters as Record<string, string | number>)).data,

  get: async (id: number) => (await api.get<GrantDetail>(`/grants/${id}/`)).data,

  summary: async (filters: GrantFilters = {}) =>
    (await api.get<GrantSummary>('/grants/summary/', filters as Record<string, string | number>)).data,

  quarterly: async (filters: GrantFilters & { fy?: string | number } = {}) =>
    (await api.get<GrantQuarterly>('/grants/quarterly/', filters as Record<string, string | number>)).data,

  create: async (data: CreateGrantRequest) => (await api.post<Grant>('/grants/', data)).data,
  update: async (id: number, data: Partial<CreateGrantRequest>) => (await api.patch<Grant>(`/grants/${id}/`, data)).data,
  remove: (id: number) => api.delete<void>(`/grants/${id}/`),

  createDisbursement: async (data: Partial<GrantDisbursement>) =>
    (await api.post<GrantDisbursement>('/grants/disbursements/', data)).data,
  createExpenditure: async (data: Partial<GrantExpenditure>) =>
    (await api.post<GrantExpenditure>('/grants/expenditures/', data)).data,
  createBudgetLine: async (data: Partial<GrantBudgetLine>) =>
    (await api.post<GrantBudgetLine>('/grants/budget-lines/', data)).data,
};
