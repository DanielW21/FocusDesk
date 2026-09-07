import { describe, expect, it } from "vitest";

import { DEFAULT_FOCUSDESK_SETTINGS, parseFocusDeskSettings } from "./settings";

describe("FocusDesk settings", () => {
  it("defaults TaskManager to open tasks", () => {
    expect(DEFAULT_FOCUSDESK_SETTINGS.taskManagerMode).toBe("list");
  });

  it("migrates the old all-tasks default without overriding an explicit choice", () => {
    expect(
      parseFocusDeskSettings({ taskManagerMode: "fulllist" }).taskManagerMode,
    ).toBe("list");
    expect(
      parseFocusDeskSettings({
        taskManagerMode: "fulllist",
        taskManagerModeConfigured: true,
      }).taskManagerMode,
    ).toBe("fulllist");
  });

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

  it("defaults WaterlooWorks to Co-op and persists optional direct coverage", () => {
    expect(parseFocusDeskSettings({}).waterlooWorks.scraperBoard).toBe("coop");
    expect(
      parseFocusDeskSettings({
        waterlooWorks: { scraperBoard: "direct", autoNext: false },
      }).waterlooWorks,
    ).toEqual({ scraperBoard: "direct", autoNext: false, keyboard: true });
  });
});
