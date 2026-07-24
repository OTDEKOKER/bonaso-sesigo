import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// Controlled current-user state used by the mocked useAuth below.
let mockUser: { confidentiality?: { required_version: string; needs_acknowledgement: boolean } } | null =
  null
let mockRevalidated = true

vi.mock("@/lib/contexts/auth-context", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: !!mockUser,
    isLoading: false,
    hasResolvedAccess: true,
    hasRevalidated: mockRevalidated,
    accessLoadFailed: false,
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}))
vi.mock("@/lib/contexts/session-mode-context", () => ({
  SessionModeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSessionMode: () => ({ isTrainingMode: false }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard",
}))
vi.mock("@/components/layout/app-sidebar", () => ({ AppSidebar: () => <div /> }))
vi.mock("@/components/layout/app-header", () => ({ AppHeader: () => <div /> }))
vi.mock("@/components/auth/idle-logout", () => ({ IdleLogout: () => null }))
vi.mock("@/lib/permissions/module-permissions", () => ({
  useModulePermissions: () => ({ canView: () => true }),
}))
vi.mock("@/lib/permissions/module-routes", () => ({ moduleForPath: () => null }))
vi.mock("@/lib/permissions", () => ({ isPlatformAdmin: () => false }))
vi.mock("@/lib/api", () => ({
  systemService: {
    getBackupStatus: () =>
      Promise.resolve({ download: { due: false, level: "green", message: null } }),
  },
}))
// Stub the gate so this suite tests the layout DECISION, not the modal internals.
vi.mock("@/components/auth/confidentiality-gate", () => ({
  ConfidentialityGate: () => <div>GATE_SHOWN</div>,
}))

import DashboardLayout from "@/app/(dashboard)/layout"

const child = <div>PROTECTED_CONTENT</div>

describe("Dashboard confidentiality gate decision", () => {
  beforeEach(() => {
    mockUser = null
    mockRevalidated = true
  })

  it("blocks protected content and shows the gate when acknowledgement is needed", () => {
    mockUser = { confidentiality: { required_version: "v1", needs_acknowledgement: true } }
    render(<DashboardLayout>{child}</DashboardLayout>)
    expect(screen.getByText("GATE_SHOWN")).toBeInTheDocument()
    expect(screen.queryByText("PROTECTED_CONTENT")).toBeNull()
  })

  it("renders protected content once acknowledged (gate gone)", () => {
    mockUser = { confidentiality: { required_version: "v1", needs_acknowledgement: false } }
    render(<DashboardLayout>{child}</DashboardLayout>)
    expect(screen.getByText("PROTECTED_CONTENT")).toBeInTheDocument()
    expect(screen.queryByText("GATE_SHOWN")).toBeNull()
  })

  it("re-gates on refresh / when the version changes (me reports needs_acknowledgement again)", () => {
    // A refresh re-fetches /me, and a bumped version flips needs_acknowledgement
    // back to true — both surface here as the gate blocking the page again.
    mockUser = { confidentiality: { required_version: "v2", needs_acknowledgement: true } }
    render(<DashboardLayout>{child}</DashboardLayout>)
    expect(screen.getByText("GATE_SHOWN")).toBeInTheDocument()
    expect(screen.queryByText("PROTECTED_CONTENT")).toBeNull()
  })

  it("gates a returning cached session whose ack status is not known yet (no dashboard flash)", () => {
    // Cached user hydrated from before this feature: no confidentiality block, and
    // the fresh /me has not resolved yet → show the gate rather than the dashboard.
    mockUser = {}
    mockRevalidated = false
    render(<DashboardLayout>{child}</DashboardLayout>)
    expect(screen.getByText("GATE_SHOWN")).toBeInTheDocument()
    expect(screen.queryByText("PROTECTED_CONTENT")).toBeNull()
  })

  it("fails OPEN once /me resolves without a confidentiality block (backend has no gate)", () => {
    // Guards against a wrong deploy order permanently locking users out: an absent
    // block after revalidation means the backend lacks the gate → allow access.
    mockUser = {}
    mockRevalidated = true
    render(<DashboardLayout>{child}</DashboardLayout>)
    expect(screen.getByText("PROTECTED_CONTENT")).toBeInTheDocument()
    expect(screen.queryByText("GATE_SHOWN")).toBeNull()
  })
})
