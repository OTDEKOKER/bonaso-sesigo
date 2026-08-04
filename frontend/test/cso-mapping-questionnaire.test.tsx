import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

// next/link -> plain anchor for jsdom.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mocked API surface (vi.hoisted so the mock factory can reference it).
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
const fetchWithAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ api, fetchWithAuth }))

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
        field("consent", "select_one", { label: "Do you consent?", required: true, list: "yes_no", choices: YN }),
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

const okJson = (status: number, data?: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data } as Response)

function mockSchema() {
  api.get.mockImplementation((url: string) =>
    url === "/cso-mapping/schema/" ? Promise.resolve({ data: SCHEMA }) : Promise.reject({ status: 404 }),
  )
}

describe("CSO Mapping questionnaire — drafts, token security & consent", () => {
  beforeEach(() => {
    localStorage.clear()
    api.get.mockReset()
    api.post.mockReset()
    fetchWithAuth.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("declining consent stores nothing and offers to change the answer", async () => {
    mockSchema()
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("radio", { name: "No" }))
    expect(await screen.findByText(/No information has been stored/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Change my answer/i })).toBeInTheDocument()
    expect(fetchWithAuth).not.toHaveBeenCalled() // no draft created
  })

  it("autosaves a draft after consent and reports 'Draft saved', storing only the token", async () => {
    mockSchema()
    fetchWithAuth.mockImplementation((path: string) =>
      path === "/cso-mapping/drafts/" ? okJson(201, { resume_token: "tok-abc", current_step: 0 }) : okJson(404, {}),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("radio", { name: "Yes" }))
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith("/cso-mapping/drafts/", expect.objectContaining({ method: "POST" })),
    )
    expect(localStorage.getItem("cso-mapping-draft-token")).toBe("tok-abc")
    expect(await screen.findByText("Draft saved")).toBeInTheDocument()
    expect(JSON.stringify(localStorage)).not.toContain("respondent_type") // answers never in storage
  })

  it("sends the resume token in the header (not the URL) and restores the draft", async () => {
    localStorage.setItem("cso-mapping-draft-token", "tok-xyz")
    mockSchema()
    fetchWithAuth.mockImplementation((path: string, opts: { method?: string }) =>
      path === "/cso-mapping/drafts/current/" && opts?.method === "GET"
        ? okJson(200, {
            answers: { consent: "yes", respondent_type: "cso" },
            current_step: 1,
            updated_at: new Date().toISOString(),
            client_submission_id: null,
          })
        : okJson(404, {}),
    )
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("button", { name: /Continue saved response/i }))
    expect(await screen.findByText(/Your saved response was restored/i)).toBeInTheDocument()

    // Token security: path is token-free and the token rides in the header.
    const getCall = fetchWithAuth.mock.calls.find(
      ([p, o]) => p === "/cso-mapping/drafts/current/" && o?.method === "GET",
    )
    expect(getCall).toBeTruthy()
    expect(getCall![0]).not.toContain("tok-xyz")
    expect(getCall![1].headers["X-CSO-Draft-Token"]).toBe("tok-xyz")
  })

  it("discards a saved draft (server DELETE via header + token cleared)", async () => {
    localStorage.setItem("cso-mapping-draft-token", "tok-del")
    mockSchema()
    fetchWithAuth.mockImplementation((path: string, opts: { method?: string }) => {
      if (path === "/cso-mapping/drafts/current/" && opts?.method === "GET")
        return okJson(200, { answers: {}, current_step: 0, updated_at: new Date().toISOString() })
      if (path === "/cso-mapping/drafts/current/" && opts?.method === "DELETE") return okJson(204)
      return okJson(404, {})
    })
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<NativeQuestionnaire />)
    fireEvent.click(await screen.findByRole("button", { name: /Start a new response/i }))
    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/cso-mapping/drafts/current/",
        expect.objectContaining({ method: "DELETE" }),
      ),
    )
    expect(localStorage.getItem("cso-mapping-draft-token")).toBeNull()
  })
})
