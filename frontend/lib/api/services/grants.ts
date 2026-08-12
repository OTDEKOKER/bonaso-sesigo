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

export const grantsService = {
  list: (filters: GrantFilters = {}) =>
    api.get<PaginatedResponse<Grant> | Grant[]>('/grants/', filters as Record<string, string | number>),

  get: (id: number) => api.get<GrantDetail>(`/grants/${id}/`),

  summary: (filters: GrantFilters = {}) =>
    api.get<GrantSummary>('/grants/summary/', filters as Record<string, string | number>),

  create: (data: CreateGrantRequest) => api.post<Grant>('/grants/', data),
  update: (id: number, data: Partial<CreateGrantRequest>) => api.patch<Grant>(`/grants/${id}/`, data),
  remove: (id: number) => api.delete<void>(`/grants/${id}/`),

  createDisbursement: (data: Partial<GrantDisbursement>) =>
    api.post<GrantDisbursement>('/grants/disbursements/', data),
  createExpenditure: (data: Partial<GrantExpenditure>) =>
    api.post<GrantExpenditure>('/grants/expenditures/', data),
  createBudgetLine: (data: Partial<GrantBudgetLine>) =>
    api.post<GrantBudgetLine>('/grants/budget-lines/', data),
};
