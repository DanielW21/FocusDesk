import { z } from "zod";

export const ActionSourceSchema = z.enum([
  "ui",
  "widget",
  "assistant",
  "workflow",
  "cli",
  "mcp",
]);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const ActionManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  title: z.string().min(1),
  mutatesData: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
});
export type ActionManifest = z.infer<typeof ActionManifestSchema>;
export type ActionManifestInput = z.input<typeof ActionManifestSchema>;
