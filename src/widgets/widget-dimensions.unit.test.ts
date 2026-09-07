import { describe, expect, it } from "vitest";

import { dimensionParts, visualHeight, visualRows } from "./widget-dimensions";

describe("widget dimensions", () => {
  it("uses the declared row count for every dimension", () => {
    expect(dimensionParts("2x2")).toEqual({ columns: 2, rows: 2 });
    expect(visualRows("2x1")).toBe(1);
    expect(visualRows("1x2")).toBe(2);
    expect(visualRows("2x2")).toBe(2);
    expect(visualRows("2x3")).toBe(3);
  });

  it("uses the declared row count for minimum heights", () => {
    expect(visualHeight("2x1")).toBe(120);
    expect(visualHeight("2x2")).toBe(254);
    expect(visualHeight("2x3")).toBe(388);
  });
});
