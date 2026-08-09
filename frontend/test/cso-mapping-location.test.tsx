import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

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
        field("physical_address", "text", { label: "Physical address" }),
      ],
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
        }),
      ],
    },
  ],
}

function mockSchema() {
  api.get.mockImplementation((url: string) =>
    url === "/cso-mapping/schema/" ? Promise.resolve({ data: SCHEMA }) : Promise.reject({ status: 404 }),
  )
}

type GeoMock = { getCurrentPosition: ReturnType<typeof vi.fn> }
function installGeolocation(): GeoMock {
  const geo = { getCurrentPosition: vi.fn() }
  Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true })
  return geo
}

/** Advance from the consent step to the administrative_information step. */
async function gotoAdminStep() {
  fireEvent.click(await screen.findByRole("radio", { name: "Yes" }))
  fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }))
  await screen.findByText("Physical address")
}

describe("CSO Mapping questionnaire — office location capture", () => {
  beforeEach(() => {
    localStorage.clear()
    api.get.mockReset()
    api.post.mockReset()
    fetchWithAuth.mockReset()
    fetchWithAuth.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response)
    mockSchema()
  })
  afterEach(() => vi.restoreAllMocks())

  it("shows the Capture Current Location button directly below Physical address", async () => {
    installGeolocation()
    render(<NativeQuestionnaire />)
    await gotoAdminStep()

    const address = screen.getByText("Physical address")
    const button = screen.getByRole("button", { name: /Capture Current Location/i })
    expect(button).toBeInTheDocument()
    // The capture control comes AFTER the Physical address field in the DOM.
    expect(address.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows 'Capturing location…' and disables the button while capturing", async () => {
    const geo = installGeolocation()
    geo.getCurrentPosition.mockImplementation(() => {
      /* never resolves — stays in the capturing state */
    })
    render(<NativeQuestionnaire />)
    await gotoAdminStep()

    fireEvent.click(screen.getByRole("button", { name: /Capture Current Location/i }))
    const capturing = await screen.findByRole("button", { name: /Capturing location/i })
    expect(capturing).toBeDisabled()
  })

  it("stores coordinates and confirms success (without showing them)", async () => {
    const geo = installGeolocation()
    geo.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { latitude: -24.6282, longitude: 25.9231, accuracy: 8 } } as GeolocationPosition),
    )
    render(<NativeQuestionnaire />)
    await gotoAdminStep()

    fireEvent.click(screen.getByRole("button", { name: /Capture Current Location/i }))
    expect(await screen.findByText("Location captured successfully")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Recapture Location/i })).toBeInTheDocument()
    // Coordinates are never rendered to the respondent.
    expect(screen.queryByText(/25\.9231/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-24\.6282/)).not.toBeInTheDocument()
  })

  it("shows the permission-denied message and allows retry", async () => {
    const geo = installGeolocation()
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 1 } as GeolocationPositionError),
    )
    render(<NativeQuestionnaire />)
    await gotoAdminStep()

    fireEvent.click(screen.getByRole("button", { name: /Capture Current Location/i }))
    expect(await screen.findByText(/Location access was denied/i)).toBeInTheDocument()
    // Still able to retry.
    expect(screen.getByRole("button", { name: /Capture Current Location/i })).toBeEnabled()
  })

  it("shows the timeout message", async () => {
    const geo = installGeolocation()
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 3 } as GeolocationPositionError),
    )
    render(<NativeQuestionnaire />)
    await gotoAdminStep()

    fireEvent.click(screen.getByRole("button", { name: /Capture Current Location/i }))
    expect(await screen.findByText(/Location capture took too long/i)).toBeInTheDocument()
  })

  it("blocks advancing past the location section until coordinates are captured", async () => {
    installGeolocation()
    render(<NativeQuestionnaire />)
    await gotoAdminStep()

    // Try to continue without capturing — the required-location error appears
    // and we do NOT reach the next section.
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }))
    expect(await screen.findByText(/The CSO office location is required/i)).toBeInTheDocument()
    expect(screen.queryByText("Confirm accurate?")).not.toBeInTheDocument()
  })
})
