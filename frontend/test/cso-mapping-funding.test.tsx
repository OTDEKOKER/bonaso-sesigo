import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
const fetchWithAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ api, fetchWithAuth }))

import { NativeQuestionnaire } from "@/components/cso-mapping/native-questionnaire"
import {
  buildPayload,
  validateStep,
  displayAnswer,
  type Field,
  type FormSchema,
  type Section,
} from "@/components/cso-mapping/schema"

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

// The funding record layout is defined ONLY here (schema), never hard-coded in
// the renderer — this test drives the field entirely off sub_fields.
const DISTRICTS = [
  { name: "Bobirwa", label: "Bobirwa" },
  { name: "Chobe", label: "Chobe" },
  { name: "Ghanzi", label: "Ghanzi" },
]
const districtsSub = field("districts", "select_multiple", {
  label: "District(s) funded / supported",
  list: "district",
  choices: DISTRICTS,
})
const fundingField = field("funding", "funding_sources", {
  label: "Current funding sources",
  item_label: "funding source",
  sub_fields: [
    field("funder_name", "text", { label: "Funder name", required: true }),
    field("project_name", "text", { label: "Project name" }),
    districtsSub,
  ],
})

const SCHEMA = {
  id_string: "t",
  version: "test-v1",
  title: "Test",
  default_language: "English (en)",
  choices: { yes_no: YN, respondent_type: [{ name: "cso", label: "CSO" }] },
  sections: [
    {
      name: "__consent",
      label: null,
      relevant: null,
      fields: [field("consent", "select_one", { label: "Do you consent?", required: true, list: "yes_no", choices: YN })],
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
        fundingField,
      ],
    },
    {
      name: "final_confirmation",
      label: "Final confirmation",
      relevant: eq("consent", "yes"),
      fields: [field("information_confirmed", "select_one", { label: "Confirm accurate?", required: true, list: "yes_no", choices: YN })],
    },
  ],
} as unknown as FormSchema

function mockSchema() {
  api.get.mockImplementation((url: string) =>
    url === "/cso-mapping/schema/" ? Promise.resolve({ data: SCHEMA }) : Promise.reject({ status: 404 }),
  )
}

async function gotoAdminStep() {
  fireEvent.click(await screen.findByRole("radio", { name: "Yes" }))
  fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }))
  await screen.findByText("Current funding sources")
}

describe("CSO Mapping — funding sources field", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSchema()
  })
  afterEach(() => vi.restoreAllMocks())

  it("shows one record by default and adds/removes more with the + button", async () => {
    render(<NativeQuestionnaire />)
    await gotoAdminStep()
    // one record → its two sub-field inputs
    expect(screen.getAllByRole("textbox")).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: /Add another funding source/i }))
    expect(screen.getAllByRole("textbox")).toHaveLength(4)
    fireEvent.click(screen.getByRole("button", { name: /Remove funding source 2/i }))
    expect(screen.getAllByRole("textbox")).toHaveLength(2)
  })

  it("selects districts funded via the multi-select sub-field", async () => {
    render(<NativeQuestionnaire />)
    await gotoAdminStep()
    const bobirwa = screen.getByRole("checkbox", { name: "Bobirwa" })
    const chobe = screen.getByRole("checkbox", { name: "Chobe" })
    fireEvent.click(bobirwa)
    fireEvent.click(chobe)
    expect((bobirwa as HTMLInputElement).checked).toBe(true)
    expect((chobe as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText("2 selected")).toBeTruthy()
  })
})

describe("funding schema helpers (config-driven)", () => {
  const section = SCHEMA.sections[1] as unknown as Section

  it("buildPayload prunes empty records and keeps filled ones", () => {
    const payload = buildPayload(SCHEMA, {
      consent: "yes",
      respondent_type: "cso",
      funding: [{ funder_name: "Global Fund", project_name: "HIV" }, { funder_name: "", project_name: "" }],
    } as never)
    expect(payload.funding).toEqual([{ funder_name: "Global Fund", project_name: "HIV" }])
  })

  it("validateStep flags a record with content but no required sub-field", () => {
    const errors = validateStep(section, {
      consent: "yes",
      respondent_type: "cso",
      funding: [{ project_name: "X" }],
    } as never)
    expect(errors.funding).toBeTruthy()
  })

  it("validateStep passes when funding is left empty (optional)", () => {
    const errors = validateStep(section, {
      consent: "yes",
      respondent_type: "cso",
      funding: [{ funder_name: "", project_name: "" }],
    } as never)
    expect(errors.funding).toBeUndefined()
  })

  it("displayAnswer formats records from sub_field labels", () => {
    const out = displayAnswer(fundingField as unknown as Field, [
      { funder_name: "Global Fund", project_name: "HIV" },
    ] as never)
    expect(out).toContain("Funder name: Global Fund")
    expect(out).toContain("Project name: HIV")
  })

  it("displayAnswer labels multi-select district codes", () => {
    const out = displayAnswer(fundingField as unknown as Field, [
      { funder_name: "Global Fund", districts: ["Bobirwa", "Chobe"] },
    ] as never)
    expect(out).toContain("District(s) funded / supported: Bobirwa, Chobe")
  })

  it("buildPayload keeps the districts list on a funded record", () => {
    const payload = buildPayload(SCHEMA, {
      consent: "yes",
      respondent_type: "cso",
      funding: [{ funder_name: "Global Fund", districts: ["Bobirwa"] }],
    } as never)
    expect(payload.funding).toEqual([{ funder_name: "Global Fund", districts: ["Bobirwa"] }])
  })

  it("buildPayload prunes a record whose only value is an empty districts list", () => {
    const payload = buildPayload(SCHEMA, {
      consent: "yes",
      respondent_type: "cso",
      funding: [{ funder_name: "", districts: [] }],
    } as never)
    expect(payload.funding).toBeUndefined()
  })
})
