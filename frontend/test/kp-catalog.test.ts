import { describe, it, expect } from "vitest";
import {
  type AggregateEntryMatrixConfig,
  getSecondaryValuesForPrimary,
  buildEmptyEntryMatrix,
  buildEntryMatrixPayload,
} from "@/lib/aggregates/aggregate-helpers";

// KP (primary) x Sex (secondary) x Age (band) matrix.
const kpSex: AggregateEntryMatrixConfig = {
  hasDisaggregates: true,
  primaryLabel: "Key Population",
  primaryValues: ["MSM", "FSW", "PWID", "GENERAL POP."],
  secondaryLabel: "Sex",
  secondaryValues: ["Male", "Female"],
  bandLabel: "Age Range",
  bandValues: ["10-14", "15-19"],
  secondaryIsSex: true,
};

// Non-sex secondary axis -> no restriction.
const svcSex: AggregateEntryMatrixConfig = {
  ...kpSex,
  primaryLabel: "Service Type",
  primaryValues: ["HTS", "PrEP"],
  secondaryIsSex: false,
};

describe("KP capture-matrix sex restriction (mirrors reporting workbook)", () => {
  it("MSM=Male-only, FSW=Female-only, others=both", () => {
    expect(getSecondaryValuesForPrimary(kpSex, "MSM")).toEqual(["Male"]);
    expect(getSecondaryValuesForPrimary(kpSex, "FSW")).toEqual(["Female"]);
    expect(getSecondaryValuesForPrimary(kpSex, "PWID")).toEqual(["Male", "Female"]);
    expect(getSecondaryValuesForPrimary(kpSex, "GENERAL POP.")).toEqual(["Male", "Female"]);
  });

  it("empty matrix omits MSM-Female and FSW-Male cells", () => {
    const matrix = buildEmptyEntryMatrix(kpSex);
    expect(matrix["MSM"]["Female"]).toBeUndefined();
    expect(matrix["FSW"]["Male"]).toBeUndefined();
    expect(matrix["MSM"]["Male"]).toBeDefined();
    expect(matrix["FSW"]["Female"]).toBeDefined();
    expect(matrix["PWID"]["Male"]).toBeDefined();
    expect(matrix["PWID"]["Female"]).toBeDefined();
  });

  it("submission payload omits the invalid KP-sex combinations", () => {
    const payload = buildEntryMatrixPayload(buildEmptyEntryMatrix(kpSex), kpSex);
    expect(payload["MSM"]["Female"]).toBeUndefined();
    expect(payload["FSW"]["Male"]).toBeUndefined();
    // MSM keeps its Male column (band cells present, empty -> undefined value).
    expect(payload["MSM"]["Male"]).toBeDefined();
    expect("10-14" in payload["MSM"]["Male"]).toBe(true);
  });

  it("does not restrict when the secondary axis is not sex", () => {
    expect(getSecondaryValuesForPrimary(svcSex, "HTS")).toEqual(["Male", "Female"]);
    expect(getSecondaryValuesForPrimary(svcSex, "PrEP")).toEqual(["Male", "Female"]);
  });
});
