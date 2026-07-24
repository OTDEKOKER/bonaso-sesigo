import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/lib/api", () => ({
  authService: {
    isAuthenticated: () => false,
    login: vi.fn(),
    offlineLogin: vi.fn(),
  },
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import LoginPage from "@/app/(auth)/login/page"

const MESSAGE = /requires acknowledgement of the confidentiality requirements/i

describe("Login confidentiality sign-out notice", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("shows the message when signed out from the gate, and clears the one-shot flag", async () => {
    sessionStorage.setItem("confidentiality_signout", "1")
    render(<LoginPage />)
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument()
    expect(sessionStorage.getItem("confidentiality_signout")).toBeNull()
  })

  it("does not show the message on a normal visit", () => {
    render(<LoginPage />)
    expect(screen.queryByText(MESSAGE)).toBeNull()
  })
})
