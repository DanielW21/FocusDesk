import { describe, expect, it } from "vitest";

import { renderSchedule } from "./renderers";

describe("workspace schedule widget renderer", () => {
  it("keeps all events available instead of truncating a busy day", () => {
    const html = renderSchedule(
      {
        data: {
          tasks: [],
          events: Array.from({ length: 7 }, (_, index) => ({
            id: index + 1,
            title: `Event ${index + 1}`,
            date: "2026-09-09",
            time: `${String(9 + index).padStart(2, "0")}:00`,
          })),
          notes: [],
          links: [],
          selectedDate: "2026-09-09",
        },
        settings: {},
      },
      "4x2",
    );

    for (let index = 1; index <= 7; index += 1)
      expect(html).toContain(`Event ${index}`);
    expect(html).toContain('style="--schedule-rows:4"');
  });
});
