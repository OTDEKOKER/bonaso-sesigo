import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformanceDetailPanel } from "@/components/dashboard/components/performance-detail-panel";

// Smoke test: the panel mounts without throwing and shows its tabs + RAG legend.
// (Guards against import/JSX regressions in the new drill-down component.)
describe("PerformanceDetailPanel", () => {
  const metrics = [
    { indicatorId: "1", label: "People tested for HIV", value: 80, target: 100, percentage: 80 },
    { indicatorId: "2", label: "Condoms distributed", value: 20, target: 100, percentage: 20 },
  ];

  it("renders the title, all three tabs, and the RAG legend by default", () => {
    render(
      <PerformanceDetailPanel
        metrics={metrics}
        organizations={[{ label: "Org A", value: 50, target: 100, percentage: 50 }]}
        projects={[]}
      />,
    );
    expect(screen.getByText("Target vs. achieved")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Breakdown" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Data" })).toBeTruthy();
    // RAG legend (Overview tab active by default) shows the "Met" band.
    expect(screen.getAllByText("Met").length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no metrics", () => {
    render(<PerformanceDetailPanel metrics={[]} organizations={[]} projects={[]} />);
    expect(screen.getByText(/Performance detail appears once indicators report/i)).toBeTruthy();
  });
});
