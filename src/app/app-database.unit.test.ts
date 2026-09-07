import { describe, expect, it } from "vitest";

import {
  FocusDeskDatabase,
  FOCUSDESK_DATABASE_KEY,
  LEGACY_FOCUSDESK_STORAGE_KEY,
  type FocusDeskDatabaseStorage,
} from "./app-database";

function createStorage(): FocusDeskDatabaseStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const fallback = {
  tasks: [],
  events: [],
  notes: [],
  links: [],
  widgetLayout: { version: 3 },
  settings: { theme: "light" },
};

describe("FocusDeskDatabase", () => {
  it("persists app-owned tables in a versioned document", () => {
    const storage = createStorage();
    const database = new FocusDeskDatabase(storage);

    database.save({
      ...fallback,
      tasks: [
        {
          id: 1,
          title: "Plan the day",
          done: false,
          tag: "Inbox",
          date: "2026-09-06",
        },
      ],
    });

    const loaded = new FocusDeskDatabase(storage).load(fallback);
    expect(loaded.tasks[0]?.title).toBe("Plan the day");
    expect(
      JSON.parse(storage.values.get(FOCUSDESK_DATABASE_KEY) ?? "{}"),
    ).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      tables: { tasks: [{ title: "Plan the day" }] },
    });
  });

  it("reads the previous focusdesk-v1 state for migration", () => {
    const storage = createStorage();
    storage.values.set(
      LEGACY_FOCUSDESK_STORAGE_KEY,
      JSON.stringify({
        ...fallback,
        notes: [
          { id: 2, title: "Idea", body: "Keep going", date: "2026-09-06" },
        ],
      }),
    );

    const loaded = new FocusDeskDatabase(storage).load(fallback);
    expect(loaded.notes).toHaveLength(1);
    expect(loaded.widgetLayout).toEqual(fallback.widgetLayout);
  });

  it("falls back when the database document is invalid", () => {
    const storage = createStorage();
    storage.values.set(
      FOCUSDESK_DATABASE_KEY,
      JSON.stringify({ schemaVersion: 99 }),
    );

    const database = new FocusDeskDatabase(storage);
    expect(database.load(fallback)).toEqual(fallback);
    database.ensure(fallback);
    expect(storage.values.has(FOCUSDESK_DATABASE_KEY)).toBe(true);
  });
});
