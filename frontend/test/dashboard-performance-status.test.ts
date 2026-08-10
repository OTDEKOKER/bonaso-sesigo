import { describe, it, expect } from "vitest";
import {
  classifyPerformance,
  getPerformanceStatus,
  getPerformanceStatusFromValues,
  PERFORMANCE_STATUS_COLORS,
  PERFORMANCE_RAG_LEGEND_ITEMS,
} from "@/components/dashboard/engine/performance-status";

describe("classifyPerformance", () => {
  it("classifies the RAG bands by percentage", () => {
    expect(classifyPerformance(150, true)).toBe("met");
    expect(classifyPerformance(100, true)).toBe("met"); // exactly 100 -> met
    expect(classifyPerformance(99.9, true)).toBe("on-track");
    expect(classifyPerformance(75, true)).toBe("on-track"); // boundary
    expect(classifyPerformance(74.9, true)).toBe("at-risk");
    expect(classifyPerformance(50, true)).toBe("at-risk"); // boundary
    expect(classifyPerformance(49.9, true)).toBe("off-track");
    expect(classifyPerformance(0, true)).toBe("off-track");
  });

  it("treats missing/invalid targets as untargeted", () => {
    expect(classifyPerformance(120, false)).toBe("untargeted");
    expect(classifyPerformance(NaN, true)).toBe("untargeted");
    expect(classifyPerformance(Infinity, true)).toBe("untargeted");
  });
});

describe("getPerformanceStatus", () => {
  it("returns matching label and colour for the status", () => {
    const met = getPerformanceStatus(100, true);
    expect(met.status).toBe("met");
    expect(met.label).toBe("Met");
    expect(met.color).toBe(PERFORMANCE_STATUS_COLORS.met);
  });
});

describe("getPerformanceStatusFromValues", () => {
  it("derives status from actual/target", () => {
    expect(getPerformanceStatusFromValues(40, 50).status).toBe("on-track"); // 80%
    expect(getPerformanceStatusFromValues(10, 100).status).toBe("off-track"); // 10%
    expect(getPerformanceStatusFromValues(60, 100).status).toBe("at-risk"); // 60%
  });

  it("returns untargeted when target is zero", () => {
    expect(getPerformanceStatusFromValues(25, 0).status).toBe("untargeted");
  });
});

describe("PERFORMANCE_RAG_LEGEND_ITEMS", () => {
  it("exposes the 4-step RAG scale without the untargeted band", () => {
    expect(PERFORMANCE_RAG_LEGEND_ITEMS).toHaveLength(4);
    expect(PERFORMANCE_RAG_LEGEND_ITEMS.map((item) => item.label)).toEqual([
      "Met",
      "On track",
      "At risk",
      "Off track",
    ]);
  });
});
