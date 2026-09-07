import { z } from "zod";

/**
 * A widget dimension is expressed as grid columns × grid rows. The current
 * desktop canvas has four columns; rows are bounded so malformed persisted
 * values cannot create an unbounded layout.
 */
export type WidgetDimension = `${number}x${number}`;
export const WidgetDimensionSchema = z.custom<WidgetDimension>(
  (value) => typeof value === "string" && /^[1-4]x[1-8]$/.test(value),
  "Widget dimensions must use the form <columns>x<rows> (1–4 × 1–8)",
);

/** Legacy values accepted only while migrating pre-dimension layouts. */
export const LegacyWidgetSizeSchema = z.enum(["small", "medium", "large"]);
export type LegacyWidgetSize = z.infer<typeof LegacyWidgetSizeSchema>;

export const WidgetCapabilitySchema = z.enum([
  "read-data",
  "mutate-data",
  "open-link",
  "start-process",
  "network-access",
]);
export type WidgetCapability = z.infer<typeof WidgetCapabilitySchema>;

export const WidgetSettingsSchema = z.record(z.string(), z.unknown());
export type WidgetSettings = z.infer<typeof WidgetSettingsSchema>;

export const WidgetManifestSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, "Widget IDs must be namespaced"),
  featureId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
  defaultDimension: WidgetDimensionSchema,
  supportedDimensions: z.array(WidgetDimensionSchema).min(1),
  capabilities: z.array(WidgetCapabilitySchema),
});
export type WidgetManifest = z.infer<typeof WidgetManifestSchema>;

export interface WidgetRenderContext {
  data: unknown;
  settings: WidgetSettings;
}

export interface WidgetView {
  render(context: WidgetRenderContext): string;
  minimumHeight?: number;
}

export interface WidgetDefinition {
  manifest: WidgetManifest;
  defaultSettings: WidgetSettings;
  views: Partial<Record<WidgetDimension, WidgetView>>;
}

export const WidgetInstanceSchema = z.object({
  id: z.string().min(1),
  widgetId: z.string().min(1),
  dimension: WidgetDimensionSchema,
  visible: z.boolean(),
  order: z.number().int().nonnegative(),
  settings: WidgetSettingsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;

export const WidgetLayoutDocumentSchema = z.object({
  version: z.literal(3),
  revision: z.number().int().nonnegative(),
  instances: z.array(WidgetInstanceSchema),
});
export type WidgetLayoutDocument = z.infer<typeof WidgetLayoutDocumentSchema>;
