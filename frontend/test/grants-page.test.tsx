import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mutable permission state so we can exercise both the access and denied paths.
const state = vi.hoisted(() => ({ canView: true, canManage: true }));

const fixtures = vi.hoisted(() => ({
  summary: {
    organizations: [
      { organization_id: 10, organization_name: "Coord A", awarded: "1000000", disbursed: "600000", spent: "1050000", remaining: "-50000", burn_pct: 105 },
      { organization_id: 20, organization_name: "MBGE", awarded: "800000", disbursed: "800000", spent: "400000", remaining: "400000", burn_pct: 50 },
    ],
    grand_total: { awarded: "1800000", disbursed: "1400000", spent: "1450000", remaining: "350000", burn_pct: 80.5, organization_count: 2 },
  },
  list: [
    { id: 1, code: "NAHPA-A-01", organization_name: "Coord A", project_name: "NAHPA SC", total_amount: "1000000", currency: "BWP", status: "active", financials: { spent: "1050000", burn_pct: 105 } },
  ],
  quarterly: {
    fiscal_year: 2026,
    available_fiscal_years: [2026],
    quarters: ["Q1", "Q2", "Q3", "Q4"],
    coordinators: [
      {
        organization_id: 10, organization_name: "Coord A", awarded: "1000000",
        quarters: { Q1: "180000", Q2: "40000", Q3: "30000", Q4: "0" }, fy_total: "250000", burn_pct: 25,
        members: [
          { organization_id: 10, organization_name: "Coord A", awarded: "700000", quarters: { Q1: "60000", Q2: "40000", Q3: "0", Q4: "0" }, fy_total: "100000", burn_pct: 14 },
          { organization_id: 20, organization_name: "MBGE", awarded: "300000", quarters: { Q1: "120000", Q2: "0", Q3: "30000", Q4: "0" }, fy_total: "150000", burn_pct: 50 },
        ],
      },
    ],
    ungrouped: [],
    grand_total: { awarded: "1000000", quarters: { Q1: "180000", Q2: "40000", Q3: "30000", Q4: "0" }, fy_total: "250000", burn_pct: 25 },
  },
}));

vi.mock("swr", () => ({
  default: (key: unknown) => {
    const k = Array.isArray(key) ? key[0] : key;
    if (k === "grants-summary") return { data: fixtures.summary, isLoading: false, mutate: vi.fn() };
    if (k === "grants-list") return { data: fixtures.list, isLoading: false, mutate: vi.fn() };
    if (k === "grants-quarterly") return { data: fixtures.quarterly, isLoading: false, mutate: vi.fn() };
    return { data: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock("@/lib/permissions/module-permissions", () => ({
  useModulePermissions: () => ({ canView: () => state.canView, can: () => state.canManage }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/hooks/use-api", () => ({
  useProjects: () => ({ data: [{ id: 1, name: "NAHPA SC" }] }),
  useOrganizations: () => ({ data: [{ id: 10, name: "Coord A" }] }),
}));

vi.mock("@/lib/api/services/grants", () => ({
  grantsService: {
    summary: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(),
    createDisbursement: vi.fn(), createExpenditure: vi.fn(), createBudgetLine: vi.fn(),
  },
}));

import GrantsPage from "@/app/(dashboard)/grants/page";

describe("GrantsPage", () => {
  beforeEach(() => {
    cleanup();
    state.canView = true;
    state.canManage = true;
  });

  it("renders the per-org summary with a grand-total row and org rows", () => {
    render(<GrantsPage />);
    // Grand total footer (2 orgs) — the headline the director sees.
    expect(screen.getByText(/GRAND TOTAL \(2\)/)).toBeTruthy();
    // Per-org rows are present (org names appear in both summary + quarterly tables).
    expect(screen.getAllByText("Coord A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MBGE").length).toBeGreaterThan(0);
    // Compact KPI currency formatting rendered (P 1.8M awarded).
    expect(screen.getByText(/P\s?1\.8M/)).toBeTruthy();
    // Quarterly section renders the coordinator rollup group header.
    expect(screen.getByText(/Quarterly expenditure by organisation/i)).toBeTruthy();
    expect(screen.getByText(/▾ Coord A/)).toBeTruthy();
  });

  it("shows an access-denied panel when the user lacks the grants module", () => {
    state.canView = false;
    render(<GrantsPage />);
    expect(screen.getByText(/do not have access to the grants module/i)).toBeTruthy();
  });
});
