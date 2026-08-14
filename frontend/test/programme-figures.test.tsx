import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock ONLY the service object; FigureChart imports GeneratedFigure as a type
// (erased at runtime), so the real renderer still runs. vi.hoisted so the mock
// fns exist before the hoisted vi.mock factory runs.
const { listTemplates, getTemplate, previewFigure } = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  previewFigure: vi.fn(),
}));
vi.mock("@/lib/api/services/funderReports", () => ({
  funderReportsService: { listTemplates, getTemplate, previewFigure },
}));

import { ProgrammeFigures } from "@/components/executive/programme-figures";

describe("ProgrammeFigures (config-driven)", () => {
  beforeEach(() => {
    listTemplates.mockResolvedValue([{ id: 1, name: "NAHPA SC 2026/27" }]);
    getTemplate.mockResolvedValue({
      sections: [{ figures: [{ id: 10, title: "HIV tests conducted", chart_type: "grouped_bar" }] }],
    });
    previewFigure.mockResolvedValue({
      figure_id: 10,
      title: "HIV tests conducted",
      chart_type: "grouped_bar",
      categories: ["MBGE", "BONELA"],
      series: [{ name: "Value", data: [850, 300] }],
    });
  });

  it("stays hidden when no project is selected (config-driven, not hardcoded)", () => {
    const { container } = render(<ProgrammeFigures projectId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("renders the project's funder-report figures via the live engine", async () => {
    render(<ProgrammeFigures projectId={3} periodStart="2026-04-01" periodEnd="2026-06-30" />);
    await waitFor(() => expect(screen.getByText("Programme Figures")).toBeInTheDocument());
    // template → figures → generate, all from config; period passed straight through
    await waitFor(() => expect(listTemplates).toHaveBeenCalledWith({ project: 3, is_active: true }));
    await waitFor(() =>
      expect(previewFigure).toHaveBeenCalledWith(10, {
        project: 3,
        period_start: "2026-04-01",
        period_end: "2026-06-30",
      }),
    );
  });
});
