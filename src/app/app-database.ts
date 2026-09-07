import { z } from "zod";

import {
  CalendarEventSchema,
  NoteSchema,
  QuickLinkSchema,
  TaskSchema,
  type CalendarEvent,
  type Note,
  type QuickLink,
  type Task,
} from "../features/workspace/model";

/**
 * FocusDesk-owned workspace data lives behind this browser fallback boundary.
 * The packaged app's task and TaskManager tables are owned by native SQLite.
 *
 * This document remains the browser-development fallback and a small local
 * mirror for export/migration. The packaged macOS app uses native SQLite as
 * the source of truth for tasks.
 */
export const FOCUSDESK_DATABASE_KEY = "focusdesk-db-v1";
export const LEGACY_FOCUSDESK_STORAGE_KEY = "focusdesk-v1";

const FocusDeskDatabaseTablesSchema = z.object({
  tasks: z.array(TaskSchema),
  events: z.array(CalendarEventSchema),
  notes: z.array(NoteSchema),
  links: z.array(QuickLinkSchema),
});

export const FocusDeskDatabaseDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  tables: FocusDeskDatabaseTablesSchema,
  dashboard: z.object({
    widgetLayout: z.unknown(),
    settings: z.unknown(),
  }),
});

export type FocusDeskDatabaseDocument = z.infer<
  typeof FocusDeskDatabaseDocumentSchema
>;

export interface FocusDeskDatabaseState {
  tasks: Task[];
  events: CalendarEvent[];
  notes: Note[];
  links: QuickLink[];
  widgetLayout: unknown;
  settings: unknown;
}

export interface FocusDeskDatabaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FocusDeskDatabaseSaveListener = (
  document: FocusDeskDatabaseDocument,
) => void;

function parseStoredValue(storage: FocusDeskDatabaseStorage, key: string) {
  const value = storage.getItem(key);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stateFromDocument(
  document: FocusDeskDatabaseDocument,
): FocusDeskDatabaseState {
  return {
    tasks: [...document.tables.tasks],
    events: [...document.tables.events],
    notes: [...document.tables.notes],
    links: [...document.tables.links],
    widgetLayout: document.dashboard.widgetLayout,
    settings: document.dashboard.settings,
  };
}

function stateFromLegacy(value: unknown): FocusDeskDatabaseState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const legacy = value as Record<string, unknown>;
  const tables = FocusDeskDatabaseTablesSchema.safeParse({
    tasks: legacy.tasks ?? [],
    events: legacy.events ?? [],
    notes: legacy.notes ?? [],
    links: legacy.links ?? [],
  });
  if (!tables.success) return undefined;

  return {
    ...tables.data,
    widgetLayout: legacy.widgetLayout ?? legacy.widgets,
    settings: legacy.settings,
  };
}

export class FocusDeskDatabase {
  #revision = 0;
  #hasCurrentDocument = false;

  constructor(
    private readonly storage: FocusDeskDatabaseStorage,
    private readonly key = FOCUSDESK_DATABASE_KEY,
    private readonly legacyKey = LEGACY_FOCUSDESK_STORAGE_KEY,
    private readonly onSave?: FocusDeskDatabaseSaveListener,
  ) {}

  load(fallback: FocusDeskDatabaseState): FocusDeskDatabaseState {
    const current = FocusDeskDatabaseDocumentSchema.safeParse(
      parseStoredValue(this.storage, this.key),
    );
    if (current.success) {
      this.#revision = current.data.revision;
      this.#hasCurrentDocument = true;
      return stateFromDocument(current.data);
    }

    this.#hasCurrentDocument = false;
    return (
      stateFromLegacy(parseStoredValue(this.storage, this.legacyKey)) ?? {
        ...fallback,
        tasks: [...fallback.tasks],
        events: [...fallback.events],
        notes: [...fallback.notes],
        links: [...fallback.links],
      }
    );
  }

  ensure(state: FocusDeskDatabaseState): void {
    if (!this.#hasCurrentDocument) this.save(state);
  }

  save(state: FocusDeskDatabaseState): FocusDeskDatabaseDocument {
    const document = this.createDocument(state, this.#revision + 1);
    this.storage.setItem(this.key, JSON.stringify(document));
    this.#revision = document.revision;
    this.#hasCurrentDocument = true;
    this.onSave?.(document);
    return document;
  }

  createDocument(
    state: FocusDeskDatabaseState,
    revision = this.#revision,
  ): FocusDeskDatabaseDocument {
    return FocusDeskDatabaseDocumentSchema.parse({
      schemaVersion: 1,
      revision,
      updatedAt: new Date().toISOString(),
      tables: {
        tasks: state.tasks,
        events: state.events,
        notes: state.notes,
        links: state.links,
      },
      dashboard: {
        widgetLayout: state.widgetLayout,
        settings: state.settings,
      },
    });
  }
}
