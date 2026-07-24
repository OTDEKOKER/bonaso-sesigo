import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// vi.hoisted runs before the hoisted vi.mock factories, so these fns exist when
// the factories reference them (avoids the "cannot access before initialization"
// TDZ error from declaring them as ordinary top-level consts).
const { logout, refreshUser, acknowledgeConfidentiality } = vi.hoisted(() => ({
  logout: vi.fn(),
  refreshUser: vi.fn(),
  acknowledgeConfidentiality: vi.fn(),
}))

vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({ logout, refreshUser }),
}))
vi.mock("@/lib/api", () => ({
  authService: { acknowledgeConfidentiality },
}))

// Imported after the mocks so the component picks up the mocked modules.
import { ConfidentialityGate } from "@/components/auth/confidentiality-gate"

const AGREE_LABEL = "I have read, understand, and agree."
const SIGNOUT = "I do not understand — Sign me out."

describe("ConfidentialityGate", () => {
  beforeEach(() => {
    logout.mockReset().mockResolvedValue(undefined)
    refreshUser.mockReset().mockResolvedValue(undefined)
    acknowledgeConfidentiality
      .mockReset()
      .mockResolvedValue({ required_version: "v1", needs_acknowledgement: false })
    sessionStorage.clear()
  })

  it("shows the notice, the acknowledgement checkbox, OK + sign-out, and NO close (X)", () => {
    render(<ConfidentialityGate />)
    expect(screen.getByText("Welcome to the Sesigo Data Portal")).toBeInTheDocument()
    expect(screen.getByRole("checkbox")).toBeInTheDocument()
    expect(screen.getByText(AGREE_LABEL)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: SIGNOUT })).toBeInTheDocument()
    // Radix's default dialog close has the accessible name "Close"; it must be gone.
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull()
  })

  it("keeps OK disabled until the acknowledgement box is ticked", async () => {
    const user = userEvent.setup()
    render(<ConfidentialityGate />)
    const ok = screen.getByRole("button", { name: "OK" })
    expect(ok).toBeDisabled()
    await user.click(screen.getByRole("checkbox"))
    expect(ok).toBeEnabled()
  })

  it("does not record if OK is somehow invoked without ticking the box", async () => {
    render(<ConfidentialityGate />)
    // Button is disabled, but guard also short-circuits programmatic clicks.
    screen.getByRole("button", { name: "OK" }).click()
    expect(acknowledgeConfidentiality).not.toHaveBeenCalled()
  })

  it("acceptance (tick + OK) records the acknowledgement, then refreshes the user", async () => {
    const user = userEvent.setup()
    render(<ConfidentialityGate />)
    await user.click(screen.getByRole("checkbox"))
    await user.click(screen.getByRole("button", { name: "OK" }))
    await waitFor(() => expect(acknowledgeConfidentiality).toHaveBeenCalledTimes(1))
    expect(refreshUser).toHaveBeenCalledTimes(1)
    expect(logout).not.toHaveBeenCalled()
  })

  it("rejection sets the /login reason flag and performs a secure logout (no record)", async () => {
    const user = userEvent.setup()
    render(<ConfidentialityGate />)
    await user.click(screen.getByRole("button", { name: SIGNOUT }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(sessionStorage.getItem("confidentiality_signout")).toBe("1")
    expect(acknowledgeConfidentiality).not.toHaveBeenCalled()
  })

  it("keeps the gate up (does not refresh) if recording the acceptance fails", async () => {
    acknowledgeConfidentiality.mockRejectedValueOnce(new Error("network"))
    const user = userEvent.setup()
    render(<ConfidentialityGate />)
    await user.click(screen.getByRole("checkbox"))
    await user.click(screen.getByRole("button", { name: "OK" }))
    await waitFor(() => expect(acknowledgeConfidentiality).toHaveBeenCalled())
    expect(refreshUser).not.toHaveBeenCalled()
    expect(screen.getByText("Welcome to the Sesigo Data Portal")).toBeInTheDocument()
  })

  it("cannot be dismissed with the Escape key", async () => {
    const user = userEvent.setup()
    render(<ConfidentialityGate />)
    await user.keyboard("{Escape}")
    expect(screen.getByText("Welcome to the Sesigo Data Portal")).toBeInTheDocument()
  })
})
