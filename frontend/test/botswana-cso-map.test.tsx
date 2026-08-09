import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// Capture what the map hands to the (canvas-based) ECharts wrapper without
// rendering a real canvas in jsdom.
const holder = vi.hoisted(() => ({ option: null as any, events: null as any }))
vi.mock("@/components/analysis/echarts/echart", () => ({
  EChart: (props: any) => {
    holder.option = props.option
    holder.events = props.onEvents
    props.onInit?.({ getDataURL: () => "data:image/png;base64,AAAA" })
    return <div data-testid="echart" role="img" aria-label={props.ariaLabel} />
  },
  registerSesigoMap: vi.fn(),
}))

const exportMocks = vi.hoisted(() => ({
  exportMapPng: vi.fn().mockResolvedValue(undefined),
  exportMapPdf: vi.fn().mockResolvedValue(undefined),
  printMap: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/components/cso-mapping/map-export", () => ({
  ...exportMocks,
  MAP_TITLE: "Map of Civil Society Organisations in Botswana",
  EXPORT_BASENAME: () => "sesigo-cso-locations-botswana-2026-08-06",
}))

const toast = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }))

const service = vi.hoisted(() => ({
  locations: vi.fn(),
  exportLocationsWorkbook: vi.fn(),
  exportLocationsGeoJSON: vi.fn(),
}))
vi.mock("@/lib/api/services/csoMapping", () => ({ csoMappingService: service }))

import { BotswanaCsoMap } from "@/components/cso-mapping/botswana-map"

const POINTS = [
  { id: 1, cso_name: "Org A", organisation_type: "Non-Governmental Organisation (NGO)", district: "Kweneng District", village_town: "", physical_address: "Plot 1, Gaborone", latitude: -24.4066, longitude: 25.4951 },
  { id: 2, cso_name: "Org B", organisation_type: "Trust", district: "", village_town: "", physical_address: "", latitude: -21.17, longitude: 27.51 },
]

const CLUSTER_SERIES = "__clusters__"
/** All plotted marker series (excludes the neutral cluster-bubble series). */
const markerSeries = () =>
  (holder.option?.series ?? []).filter((s: any) => s.name !== CLUSTER_SERIES)
const allMarkerData = () => markerSeries().flatMap((s: any) => s.data ?? [])

beforeEach(() => {
  holder.option = null
  holder.events = null
  toast.mockReset()
  service.locations.mockReset().mockResolvedValue(POINTS)
  service.exportLocationsWorkbook.mockReset().mockResolvedValue(new Blob(["x"]))
  service.exportLocationsGeoJSON.mockReset().mockResolvedValue(new Blob(["{}"]))
  // Boundary GeoJSON + settlements gazetteer fetches (routed by URL).
  global.fetch = vi.fn((url: RequestInfo | URL) => {
    if (String(url).includes("settlements")) {
      return Promise.resolve({
        ok: true,
        // Molepolole sits exactly on Org A's coordinate; Maun elsewhere.
        json: async () => ({
          places: [
            ["Molepolole", -24.4066, 25.4951],
            ["Maun", -19.9833, 23.4167],
          ],
        }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) })
  }) as unknown as typeof fetch
  // jsdom lacks object URL helpers used by the download path.
  ;(URL as any).createObjectURL = vi.fn(() => "blob:x")
  ;(URL as any).revokeObjectURL = vi.fn()
})

describe("BotswanaCsoMap", () => {
  it("renders all five export/print buttons", async () => {
    render(<BotswanaCsoMap />)
    for (const label of [
      "Download Map as PNG",
      "Download Map as PDF",
      "Export Locations to Excel",
      "Export GeoJSON",
      "Print Map",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
  })

  it("plots one point per CSO with [longitude, latitude] order", async () => {
    render(<BotswanaCsoMap />)
    // Markers are split into one scatter series per organisation type; the two
    // points land across those series (never duplicated, never dropped).
    await waitFor(() => expect(allMarkerData().length).toBe(2))
    const values = allMarkerData().map((d: any) => d.value)
    expect(values).toContainEqual([25.4951, -24.4066]) // [lng, lat] — not reversed
    expect(values).toContainEqual([27.51, -21.17])
    // Two boundary layers: districts (coordinate system) + national outline.
    expect(Array.isArray(holder.option.geo)).toBe(true)
    expect(holder.option.geo[0].map).toBe("botswana-subdistricts")
    expect(holder.option.geo[1].map).toBe("botswana-national")
  })

  it("point popup shows name/type/district/village/address, escaped, with 'Not provided' fallback", async () => {
    render(<BotswanaCsoMap />)
    await waitFor(() => expect(holder.option).toBeTruthy())
    const formatter = holder.option.tooltip.formatter
    // Meta as the map builds it (annotated with category + geoDistrict).
    const meta = { ...POINTS[0], category: "Non-Governmental Organisation (NGO)", geoDistrict: "Kweneng District" }
    const html = formatter({ seriesType: "scatter", data: { meta } })
    expect(html).toContain("Org A")
    expect(html).toContain("Non-Governmental Organisation (NGO)") // organisation type
    expect(html).toContain("Kweneng District")
    expect(html).toContain("Plot 1, Gaborone") // physical address
    expect(html).toContain("Not provided") // empty village -> Not provided
    // No coordinates leak into the popup.
    expect(html).not.toContain("25.4951")
    expect(html).not.toContain("-24.4066")
    // Boundary (map) hovers/clicks produce no popup.
    expect(formatter({ seriesType: "map", data: {} })).toBe("")
    // Cluster bubbles show a count + zoom hint, not organisation detail.
    const clusterHtml = formatter({ seriesName: CLUSTER_SERIES, data: { count: 3 } })
    expect(clusterHtml).toContain("3 organisations")
  })

  it("escapes HTML in dynamic popup values", async () => {
    render(<BotswanaCsoMap />)
    await waitFor(() => expect(holder.option).toBeTruthy())
    const formatter = holder.option.tooltip.formatter
    const html = formatter({
      seriesType: "scatter",
      data: { meta: { cso_name: "<img src=x onerror=alert(1)>", district: "", village_town: "" } },
    })
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img")
  })

  it("Excel export calls the service and surfaces errors without crashing", async () => {
    service.exportLocationsWorkbook.mockRejectedValueOnce(new Error("boom"))
    render(<BotswanaCsoMap />)
    fireEvent.click(screen.getByRole("button", { name: "Export Locations to Excel" }))
    await waitFor(() => expect(service.exportLocationsWorkbook).toHaveBeenCalled())
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    )
    // Page still shows the map / buttons (no crash).
    expect(screen.getByRole("button", { name: "Export GeoJSON" })).toBeInTheDocument()
  })

  it("derives Village/Town from the nearest settlement (no form field exists)", async () => {
    render(<BotswanaCsoMap />)
    // Org A is at Molepolole's coordinate → the derived village appears both in
    // the Village/Town filter and in the click popup.
    const select = await screen.findByLabelText("Filter by village or town")
    await waitFor(() =>
      expect(
        Array.from(select.querySelectorAll("option")).map((o) => o.textContent),
      ).toContain("Molepolole"),
    )
    const meta = { ...POINTS[0], village: "Molepolole", geoDistrict: "Kweneng District" }
    const html = holder.option.tooltip.formatter({ seriesType: "scatter", data: { meta } })
    expect(html).toContain("Molepolole")
  })

  it("shows an empty state when there are no located CSOs (map still shown)", async () => {
    service.locations.mockResolvedValueOnce([])
    render(<BotswanaCsoMap />)
    expect(await screen.findByText(/No CSO locations are available yet/i)).toBeInTheDocument()
    expect(screen.getByTestId("echart")).toBeInTheDocument()
  })

  it("shows a boundary error state when the GeoJSON cannot load", async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<BotswanaCsoMap />)
    expect(
      await screen.findByText(/The Botswana map could not be loaded\. Please try again\./i),
    ).toBeInTheDocument()
  })
})
