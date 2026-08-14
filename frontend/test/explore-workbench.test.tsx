import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ExploreWorkbench } from "@/components/explore/explore-workbench";

// Presentational component — fed a fixture directly, no network/auth. Charts
// render through the REAL widget registry; drill-down uses the REAL
// PerformanceDetailPanel.
const METRICS = [
  { indicatorId: "1", label: "HIV tests", percentage: 80, target: 1000, value: 800 },
  { indicatorId: "2", label: "STI screening", percentage: 40, target: 500, value: 200 },
];
const ORGS = [
  { label: "MBGE", value: 920, target: 1000, percentage: 92 },
  { label: "BONELA", value: 320, target: 1000, percentage: 32 },
];
const PROJECTS = [{ label: "NAHPA SC 2026/27", value: 1240, target: 1500, percentage: 82.7 }];

function renderWorkbench() {
  return render(
    <ExploreWorkbench indicatorMetrics={METRICS} organizations={ORGS} projects={PROJECTS} />,
  );
}

describe("ExploreWorkbench", () => {
  it("shows the empty canvas until a visualization is added", () => {
    renderWorkbench();
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText(/Your canvas is empty/i)).toBeInTheDocument();
  });

  it("toggles layout density", () => {
    renderWorkbench();
    const compact = screen.getByRole("button", { name: "Compact" });
    expect(compact).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(compact);
    expect(compact).toHaveAttribute("aria-pressed", "true");
  });

  it("builds a visualization from a selected indicator and renders it on the canvas", () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole("button", { name: /Add your first visualization/i }));
    // dialog open
    expect(screen.getByText("New visualization")).toBeInTheDocument();
    // pick an indicator (clicking the label toggles its checkbox)
    fireEvent.click(screen.getByText("HIV tests"));
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    // dialog closed, a card now exists (Drill down + Remove controls present)
    expect(screen.queryByText("New visualization")).toBeNull();
    expect(screen.getByRole("button", { name: "Drill down" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove HIV tests/i })).toBeInTheDocument();
  });

  it("opens the drill-down panel for a card", () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole("button", { name: /Add your first visualization/i }));
    fireEvent.click(screen.getByText("STI screening"));
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    fireEvent.click(screen.getByRole("button", { name: "Drill down" }));
    expect(screen.getByText(/Drill down — STI screening/i)).toBeInTheDocument();
  });
});
