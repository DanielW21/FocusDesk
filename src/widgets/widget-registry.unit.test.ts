import { describe, expect, it } from "vitest";

import { defineWidget } from "./define-widget";
import { WidgetRegistry } from "./widget-registry";

function testWidget() {
  return defineWidget({
    id: "example.jobs",
    featureId: "example",
    title: "Jobs",
    description: "Job search status",
    icon: "J",
    defaultDimension: "2x2",
    views: {
      "2x2": { render: () => "2x2" },
      "2x3": { render: () => "2x3" },
    },
  });
}

describe("WidgetRegistry", () => {
  it("cycles only through dimensions implemented by a widget", () => {
    const registry = new WidgetRegistry();
    registry.register(testWidget());

    expect(registry.nextDimension("example.jobs", "2x2")).toBe("2x3");
    expect(registry.nextDimension("example.jobs", "2x3")).toBe("2x2");
  });

  it("rejects duplicate IDs", () => {
    const registry = new WidgetRegistry();
    registry.register(testWidget());

    expect(() => registry.register(testWidget())).toThrow("already registered");
  });
});
