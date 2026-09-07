import { describe, expect, it } from "vitest";

import { defineWidget } from "./define-widget";

describe("defineWidget", () => {
  it("derives supported dimensions from the implemented views", () => {
    const widget = defineWidget({
      id: "example.jobs",
      featureId: "example",
      title: "Jobs",
      description: "Job search status",
      icon: "J",
      defaultDimension: "2x2",
      views: {
        "2x2": { render: () => "2x2" },
        "4x2": { render: () => "4x2" },
      },
    });

    expect(widget.manifest.supportedDimensions).toEqual(["2x2", "4x2"]);
  });

  it("rejects a default dimension without a view", () => {
    expect(() =>
      defineWidget({
        id: "example.jobs",
        featureId: "example",
        title: "Jobs",
        description: "Job search status",
        icon: "J",
        defaultDimension: "1x1",
        views: { "2x2": { render: () => "2x2" } },
      }),
    ).toThrow("must implement its default dimension");
  });
});
