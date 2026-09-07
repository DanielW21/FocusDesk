import { z } from "zod";

import type { WidgetDefinition } from "./widgets";

export const FeatureManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  title: z.string().min(1),
  icon: z.string().min(1),
});
export type FeatureManifest = z.infer<typeof FeatureManifestSchema>;

export interface FeatureDefinition {
  manifest: FeatureManifest;
  widgets: readonly WidgetDefinition[];
}
