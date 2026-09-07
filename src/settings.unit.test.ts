import { describe, expect, it } from "vitest";

import { DEFAULT_FOCUSDESK_SETTINGS, parseFocusDeskSettings } from "./settings";

describe("FocusDesk settings", () => {
  it("fills in defaults for older saved workspaces", () => {
    expect(parseFocusDeskSettings({ theme: "dark" })).toEqual({
      ...DEFAULT_FOCUSDESK_SETTINGS,
      theme: "dark",
    });
  });

  it("rejects invalid persisted values without throwing", () => {
    expect(parseFocusDeskSettings({ density: "tiny" })).toEqual(
      DEFAULT_FOCUSDESK_SETTINGS,
    );
  });
});
