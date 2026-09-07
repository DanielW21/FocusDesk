import { describe, expect, it } from "vitest";
import { createDefaultWidgetLayout } from "../features/workspace/default-layout";
import { withWaterlooWorksWidget } from "./feature-layout-upgrades";

describe("feature widget installation", () => {
  it("adds the WaterlooWorks widget without changing existing positions", () => {
    const original = createDefaultWidgetLayout();
    const upgraded = withWaterlooWorksWidget(original);
    expect(upgraded.instances.slice(0, -1)).toEqual(original.instances);
    expect(upgraded.instances[upgraded.instances.length - 1]).toMatchObject({
      widgetId: "waterlooworks.jobs",
      dimension: "2x1",
      visible: true,
    });
    expect(withWaterlooWorksWidget(upgraded)).toBe(upgraded);
  });

  it("never restores a widget the user hid or changes its dimensions", () => {
    const layout = withWaterlooWorksWidget(createDefaultWidgetLayout());
    const widget = layout.instances[layout.instances.length - 1]!;
    widget.visible = false;
    widget.dimension = "4x2";
    expect(withWaterlooWorksWidget(layout)).toBe(layout);
    expect(widget.visible).toBe(false);
    expect(widget.dimension).toBe("4x2");
  });
});
