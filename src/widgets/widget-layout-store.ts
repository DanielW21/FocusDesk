import {
  LegacyWidgetSizeSchema,
  WidgetDimensionSchema,
  WidgetLayoutDocumentSchema,
  WidgetSettingsSchema,
  type WidgetDimension,
  type WidgetInstance,
  type WidgetLayoutDocument,
} from "../contracts/widgets";
import type { WidgetRegistry } from "./widget-registry";

const legacyWidgetIds: Record<string, string> = {
  tracker: "workspace.tracker",
  clock: "workspace.clock",
  tasks: "workspace.tasks",
  schedule: "workspace.schedule",
  focus: "workspace.focus",
  notes: "workspace.notes",
  links: "workspace.links",
};

const legacySizeDimensions: Record<
  "small" | "medium" | "large",
  WidgetDimension
> = {
  small: "1x2",
  medium: "2x2",
  large: "4x2",
};

interface LegacyWidgetInstance {
  id?: unknown;
  type?: unknown;
  widgetId?: unknown;
  size?: unknown;
  dimension?: unknown;
  visible?: unknown;
  order?: unknown;
  settings?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function cloneLayout(layout: WidgetLayoutDocument): WidgetLayoutDocument {
  return {
    ...layout,
    instances: layout.instances.map((instance) => ({
      ...instance,
      settings: { ...instance.settings },
    })),
  };
}

function dimensionFromLegacy(value: unknown): WidgetDimension {
  const dimension = WidgetDimensionSchema.safeParse(value);
  if (dimension.success) return dimension.data;

  const size = LegacyWidgetSizeSchema.safeParse(value);
  return size.success ? legacySizeDimensions[size.data] : "1x2";
}

function timestampFromLegacy(value: unknown, fallback: string): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : fallback;
}

function migrateInstance(
  raw: unknown,
  order: number,
  now: string,
): WidgetInstance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const legacy = raw as LegacyWidgetInstance;
  const sourceId =
    typeof legacy.widgetId === "string" ? legacy.widgetId : legacy.type;
  const widgetId =
    typeof sourceId === "string"
      ? (legacyWidgetIds[sourceId] ?? sourceId)
      : undefined;
  if (!widgetId || typeof legacy.id !== "string") return undefined;

  const settings = WidgetSettingsSchema.safeParse(legacy.settings);
  return {
    id: legacy.id,
    widgetId,
    dimension: dimensionFromLegacy(legacy.dimension ?? legacy.size),
    visible: typeof legacy.visible === "boolean" ? legacy.visible : true,
    order,
    settings: settings.success ? settings.data : {},
    createdAt: timestampFromLegacy(legacy.createdAt, now),
    updatedAt: timestampFromLegacy(legacy.updatedAt, now),
  };
}

function migrateInstances(
  rawInstances: unknown,
  now: string,
  revision = 0,
): WidgetLayoutDocument | undefined {
  if (!Array.isArray(rawInstances)) return undefined;
  const instances: WidgetInstance[] = [];
  for (const [order, raw] of rawInstances.entries()) {
    const candidate =
      raw && typeof raw === "object"
        ? (raw as LegacyWidgetInstance)
        : undefined;
    const persistedOrder =
      candidate &&
      typeof candidate.order === "number" &&
      Number.isInteger(candidate.order) &&
      candidate.order >= 0
        ? candidate.order
        : order;
    const instance = migrateInstance(raw, persistedOrder, now);
    if (!instance) return undefined;
    instances.push(instance);
  }

  const parsed = WidgetLayoutDocumentSchema.safeParse({
    version: 3,
    revision,
    instances,
  });
  return parsed.success ? parsed.data : undefined;
}

function migrateLegacyWidgets(
  value: unknown,
  now: string,
): WidgetLayoutDocument | undefined {
  if (Array.isArray(value)) return migrateInstances(value, now);
  if (!value || typeof value !== "object") return undefined;

  const legacyDocument = value as {
    version?: unknown;
    revision?: unknown;
    instances?: unknown;
  };
  if (legacyDocument.version !== 2) return undefined;
  const revision =
    typeof legacyDocument.revision === "number" &&
    Number.isInteger(legacyDocument.revision) &&
    legacyDocument.revision >= 0
      ? legacyDocument.revision
      : 0;
  return migrateInstances(legacyDocument.instances, now, revision);
}

export class WidgetLayoutStore {
  constructor(private readonly registry: WidgetRegistry) {}

  load(
    value: unknown,
    fallback: WidgetLayoutDocument,
    now = new Date().toISOString(),
  ): WidgetLayoutDocument {
    const current = WidgetLayoutDocumentSchema.safeParse(value);
    const migrated = current.success
      ? current.data
      : migrateLegacyWidgets(value, now);
    return this.repair(migrated ?? fallback);
  }

  repair(layout: WidgetLayoutDocument): WidgetLayoutDocument {
    const fallback = cloneLayout(layout);
    const instances = fallback.instances
      .filter((instance) => this.registry.get(instance.widgetId) !== undefined)
      .sort((left, right) => left.order - right.order)
      .map((instance, order) => {
        const definition = this.registry.require(instance.widgetId);
        const dimension = definition.views[instance.dimension]
          ? instance.dimension
          : definition.manifest.defaultDimension;
        return { ...instance, dimension, order };
      });

    return { ...fallback, instances };
  }
}
