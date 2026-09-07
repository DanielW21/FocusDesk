import { describe, expect, it } from "vitest";

import { renderTaskManager } from "./renderers";

describe("TaskManager widget renderer", () => {
  it("shows course codes and omits midnight times", () => {
    const today = new Date();
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const dateLabel = new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
    }).format(new Date(`${dateString}T12:00:00`));
    const html = renderTaskManager(
      {
        data: {
          taskManager: {
            status: "ready",
            tasks: [
              {
                id: "task-1",
                courseCode: "BME 362",
                title: "Review notes",
                done: false,
                date: dateString,
                time: "09:00",
                priority: "normal",
              },
              {
                id: "task-2",
                courseCode: "BME 384",
                title: "Exam",
                done: false,
                date: dateString,
                priority: "normal",
              },
            ],
          },
        },
        settings: {},
      },
      "4x3",
    );

    expect(html).toContain("BME 362 - Review notes");
    expect(html).toContain(`${dateLabel} · 9:00 AM`);
    expect(html).toContain("BME 384 - Exam");
    expect(html).not.toContain("12:00 AM");
  });

  it("offers the full open list when the week exceeds visible rows", () => {
    const today = new Date();
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const html = renderTaskManager(
      {
        data: {
          taskManager: {
            status: "ready",
            tasks: Array.from({ length: 5 }, (_, index) => ({
              id: `task-${index}`,
              courseCode: "BME 362",
              title: `Task ${index}`,
              done: false,
              date: dateString,
              priority: "normal" as const,
            })),
          },
        },
        settings: {},
      },
      "2x2",
    );

    expect(html).toContain("View more (1) ↗");
  });

  it("fills unused weekly space with a labeled upcoming section", () => {
    const today = new Date();
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const futureDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 14,
    );
    const futureDateString = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")}`;
    const html = renderTaskManager(
      {
        data: {
          taskManager: {
            status: "ready",
            tasks: [
              {
                id: "this-week",
                courseCode: "BME 362",
                title: "This week",
                done: false,
                date: dateString,
                priority: "normal",
              },
              {
                id: "upcoming",
                courseCode: "BME 384",
                title: "Upcoming exam",
                done: false,
                date: futureDateString,
                priority: "normal",
              },
            ],
          },
        },
        settings: {},
      },
      "4x3",
    );

    expect(html).toContain("Upcoming");
    expect(html).toContain("BME 384 - Upcoming exam");
  });

  it("shows the weekly completion message before future tasks", () => {
    const today = new Date();
    const futureDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 14,
    );
    const futureDateString = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")}`;
    const html = renderTaskManager(
      {
        data: {
          taskManager: {
            status: "ready",
            tasks: [
              {
                id: "upcoming",
                courseCode: "BME 384",
                title: "Upcoming exam",
                done: false,
                date: futureDateString,
                priority: "normal",
              },
            ],
          },
        },
        settings: {},
      },
      "4x3",
    );

    expect(html).toContain("All done for the week!");
    expect(html).toContain("Upcoming");
    expect(html).toContain("BME 384 - Upcoming exam");
  });

  it("renders every open task in expanded mode", () => {
    const html = renderTaskManager(
      {
        data: {
          taskManager: {
            status: "ready",
            tasks: Array.from({ length: 5 }, (_, index) => ({
              id: `task-${index}`,
              courseCode: "BME 362",
              title: `Task ${index}`,
              done: false,
              date: "2099-09-11",
              priority: "normal" as const,
            })),
          },
        },
        settings: { taskManagerExpanded: true },
      },
      "2x2",
    );

    expect(html).toContain("BME 362 - Task 4");
    expect(html).not.toContain("View more");
  });
});
