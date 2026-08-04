import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

// next/link -> plain anchor for jsdom.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mocked public API client (vi.hoisted so the mock factory can reference it).
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
vi.mock("@/lib/api", () => ({ api }))

import { NativeQuestionnaire } from "@/components/cso-mapping/native-questionnaire"

const YN = [
  { name: "yes", label: "Yes" },
  { name: "no", label: "No" },
]
const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  label: name,
  hint: null,
  required: false,
  multiline: false,
  relevant: null,
  constraint: null,
  ...extra,
})
const eq = (f: string, v: string) => ({ field: f, op: "eq", value: v })

const SCHEMA = {
  version: "test-v1",
  title: "Test",
  default_language: "English (en)",
  choices: { yes_no: YN, respondent_type: [{ name: "cso", label: "CSO" }] },
  sections: [
    {
      name: "__consent",
      label: null,
      relevant: null,
      fields: [
        field("consent", "select_one", {
          label: "Do you consent?",
          required: true,
          list: "yes_no",
          choices: YN,
        }),
        field("no_consent", "note", { label: "No consent note.", relevant: eq("consent", "no") }),
      ],
    },
    {
      name: "administrative_information",
      label: "Administrative information",
      relevant: eq("consent", "yes"),
      fields: [
        field("respondent_type", "select_one", {
          label: "Category",
          required: true,
          list: "respondent_type",
          choices: [{ name: "cso", label: "CSO" }],
        }),
        field("responding_entity", "text", { label: "Organisation name", required: true }),
      ],
    },
    {
      name: "annex2_domain_1",
      label: "Annex 2",
      relevant: eq("respondent_type", "cso"),
      fields: [field("annex2_a2_1a", "text", { label: "Nature", required: true, multiline: true })],
    },
    {
      name: "final_confirmation",
      label: "Final confirmation",
      relevant: eq("consent", "yes"),
      fields: [
        field("information_confirmed", "select_one", {
          label: "Confirm accurate?",
          required: true,
          list: "yes_no",
          choices: YN,
          constraint: { field: ".", op: "eq", value: "yes" },
        }),
      ],
    },
  ],
}

function mockSchemaOnly() {
  api.get.mockImplementation((url: string) => {
    if (url === "/cso-mapping/schema/") return Promise.resolve({ data: SCHEMA })
    return Promise.reject({ status: 404 })
  })
}

describe("CSO Mapping questionnaire — drafts & consent", () => {
  beforeEach(() => {
    localStorage.clear()
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
    api.delete.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("declining consent stores nothing and offers to change the answer", async () => {
    mockSchemaOnly()
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("radio", { name: "No" }))
    expect(await screen.findByText(/No information has been stored/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Change my answer/i })).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled() // no submission/draft created
  })

  it("autosaves a draft after consent and reports 'Draft saved', storing only the token", async () => {
    mockSchemaOnly()
    api.post.mockResolvedValue({ data: { resume_token: "tok-abc", current_step: 0 } })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("radio", { name: "Yes" }))
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/cso-mapping/drafts/", expect.any(Object)))
    expect(localStorage.getItem("cso-mapping-draft-token")).toBe("tok-abc")
    expect(await screen.findByText("Draft saved")).toBeInTheDocument()
    // The answers themselves are never in browser storage.
    expect(JSON.stringify(localStorage)).not.toContain("respondent_type")
  })

  it("prompts to resume a saved draft on this device and restores it", async () => {
    localStorage.setItem("cso-mapping-draft-token", "tok-xyz")
    api.get.mockImplementation((url: string) => {
      if (url === "/cso-mapping/schema/") return Promise.resolve({ data: SCHEMA })
      if (url === "/cso-mapping/drafts/tok-xyz/")
        return Promise.resolve({
          data: {
            answers: { consent: "yes", respondent_type: "cso" },
            current_step: 1,
            updated_at: new Date().toISOString(),
            client_submission_id: null,
          },
        })
      return Promise.reject({ status: 404 })
    })
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("button", { name: /Continue saved response/i }))
    expect(await screen.findByText(/Your saved response was restored/i)).toBeInTheDocument()
  })

  it("discards a saved draft (server DELETE + token cleared)", async () => {
    localStorage.setItem("cso-mapping-draft-token", "tok-del")
    api.get.mockImplementation((url: string) => {
      if (url === "/cso-mapping/schema/") return Promise.resolve({ data: SCHEMA })
      if (url === "/cso-mapping/drafts/tok-del/")
        return Promise.resolve({ data: { answers: {}, current_step: 0, updated_at: new Date().toISOString() } })
      return Promise.reject({ status: 404 })
    })
    api.delete.mockResolvedValue({ data: null })
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("button", { name: /Start a new response/i }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/cso-mapping/drafts/tok-del/"))
    expect(localStorage.getItem("cso-mapping-draft-token")).toBeNull()
  })
})
