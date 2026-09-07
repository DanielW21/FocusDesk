import { describe, expect, it } from "vitest";
import {
  formatWaterlooWorksDate,
  timestampFromWaterlooWorks,
} from "./date-utils";
import { defaultFilters, filterJobs } from "./job-logic";
import type { JobEntry } from "./model";

describe("WaterlooWorks date handling", () => {
  it("formats epoch milliseconds without leaking the raw value into the UI", () => {
    expect(formatWaterlooWorksDate(1_789_650_000_000)).toBe("2026-09-17");
    expect(formatWaterlooWorksDate("1789650000000")).toBe("2026-09-17");
  });

  it("accepts epoch seconds and ISO timestamps while rejecting arbitrary numbers", () => {
    expect(timestampFromWaterlooWorks(1_789_650_000)).toBe(1_789_650_000_000);
    expect(timestampFromWaterlooWorks("2026-09-17T21:00:00.000Z")).toBe(
      1_789_678_800_000,
    );
    expect(Number.isNaN(timestampFromWaterlooWorks("485999"))).toBe(true);
  });

  it("uses epoch deadlines for deadline filtering and sorting", () => {
    const jobs: JobEntry[] = [
      entry("late", 1_789_650_000_000),
      entry("early", 1_789_563_600_000),
    ];
    const filters = {
      ...defaultFilters(),
      deadline: "2026-09-17",
      sort: "deadline",
    };
    expect(filterJobs(jobs, filters).map((job) => job.job.id)).toEqual([
      "early",
      "late",
    ]);
  });
});

function entry(id: string, deadlineAt: number): JobEntry {
  return {
    board: "Co-op",
    job: { id, dates: { deadlineAt } },
  };
}
