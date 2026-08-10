import { describe, it, expect } from "vitest";
import { metricsToCsv } from "@/lib/dashboard/export-metrics";

describe("metricsToCsv", () => {
  it("emits a header plus one row per metric with RAG status", () => {
    const csv = metricsToCsv([
      { indicatorId: "1", label: "People tested", value: 80, target: 100, percentage: 80 },
      { indicatorId: "2", label: "Condoms distributed", value: 30, target: 100, percentage: 30 },
      { indicatorId: "3", label: "Untargeted count", value: 5, target: 0, percentage: 0 },
    ]);
    const rows = csv.split("\r\n");
    expect(rows[0]).toBe("Indicator,Target,Achieved,Achievement %,Status");
    expect(rows[1]).toBe("People tested,100,80,80.0,On track");
    expect(rows[2]).toBe("Condoms distributed,100,30,30.0,Off track");
    // No target -> blank percentage, "No target" status
    expect(rows[3]).toBe("Untargeted count,0,5,,No target");
  });

  it("escapes commas and quotes in indicator labels", () => {
    const csv = metricsToCsv([
      { indicatorId: "1", label: 'People reached, "priority" pop', value: 10, target: 10, percentage: 100 },
    ]);
    const dataRow = csv.split("\r\n")[1];
    expect(dataRow).toBe('"People reached, ""priority"" pop",10,10,100.0,Met');
  });
});
