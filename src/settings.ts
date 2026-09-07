import { z } from "zod";
import { PageConfigSchema } from "./features/waterlooworks/model";

export const FocusDeskThemeSchema = z.enum(["light", "dark"]);
export const FocusDeskDensitySchema = z.enum([
  "compact",
  "comfortable",
  "spacious",
]);
export const FocusDeskAccentSchema = z.enum(["coral", "sage", "blue", "gold"]);
export const FocusDeskTaskManagerModeSchema = z.enum([
  "list",
  "fulllist",
  "exams",
  "progress",
  "todo",
]);
export const FocusDeskProgressViewSchema = z.enum(["compact", "detailed"]);

export const FocusDeskSettingsSchema = z.object({
  theme: FocusDeskThemeSchema,
  density: FocusDeskDensitySchema,
  accent: FocusDeskAccentSchema,
  taskManagerMode: FocusDeskTaskManagerModeSchema,
  taskManagerProgressView: FocusDeskProgressViewSchema,
  taskManagerTodoDays: z.number().int().min(0).max(90),
  focusDurationMinutes: z.number().int().min(5).max(120),
  googleCalendarIds: z.array(z.string().min(1)).max(100),
  googleCalendarAutoSync: z.boolean(),
  googleCalendarSelectionInitialized: z.boolean(),
  googleCalendarSelectionVersion: z.number().int().min(0).max(10),
  waterlooWorks: PageConfigSchema,
});

export type FocusDeskSettings = z.infer<typeof FocusDeskSettingsSchema>;

export const DEFAULT_FOCUSDESK_SETTINGS: FocusDeskSettings = {
  theme: "light",
  density: "comfortable",
  accent: "coral",
  taskManagerMode: "fulllist",
  taskManagerProgressView: "compact",
  taskManagerTodoDays: 7,
  focusDurationMinutes: 25,
  googleCalendarIds: ["primary"],
  googleCalendarAutoSync: true,
  googleCalendarSelectionInitialized: false,
  googleCalendarSelectionVersion: 0,
  waterlooWorks: PageConfigSchema.parse({}),
};

export function parseFocusDeskSettings(value: unknown): FocusDeskSettings {
  const parsed = FocusDeskSettingsSchema.partial().safeParse(value);
  if (!parsed.success) return { ...DEFAULT_FOCUSDESK_SETTINGS };
  return {
    ...DEFAULT_FOCUSDESK_SETTINGS,
    ...parsed.data,
  };
}
