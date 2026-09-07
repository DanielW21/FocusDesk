import { z } from "zod";

export const RankSchema = z.number().int().min(1).max(5);
export const BoardCoverageSchema = z.enum(["coop", "direct", "both"]);
export type BoardCoverage = z.infer<typeof BoardCoverageSchema>;
export const PageConfigSchema = z.object({
  scraperBoard: BoardCoverageSchema.default("coop"),
  keyboard: z.boolean().default(true),
  autoNext: z.boolean().default(true),
});
export type PageConfig = z.infer<typeof PageConfigSchema>;
const richObject = z.record(z.string(), z.unknown());
export const JobEntrySchema = z
  .object({
    board: z.string().min(1),
    job: z
      .object({
        id: z.union([z.string().min(1), z.number().int()]).transform(String),
        jobTitle: z.string().nullish(),
        url: z.string().nullish(),
        company: richObject.nullish(),
        location: richObject.nullish(),
        dates: richObject.nullish(),
        salaries: richObject.nullish(),
        descriptions: z
          .array(
            z
              .object({
                title: z.string().nullish(),
                content: z.string().nullish(),
              })
              .passthrough(),
          )
          .nullish(),
      })
      .passthrough(),
    grade: z
      .object({
        totalScore: z.number().nullish(),
        relevantCandidate: z.boolean().nullish(),
        categoryScores: richObject.nullish(),
        summary: richObject.nullish(),
      })
      .passthrough()
      .nullish(),
    rating: RankSchema.nullish(),
    firstSeenAt: z.string().nullish(),
    lastSeenAt: z.string().nullish(),
  })
  .passthrough();
export type JobEntry = z.infer<typeof JobEntrySchema>;
export const JobsResponseSchema = z
  .object({
    jobs: z.array(JobEntrySchema),
    page: z
      .object({
        total: z.number().nonnegative().optional(),
        nextCursor: z.string().nullish(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export const RunSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().optional(),
    kind: z.string().optional(),
    status: z.string(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    message: z.string().nullish(),
  })
  .passthrough();
export type Run = z.infer<typeof RunSchema>;
export const CapabilitiesSchema = z
  .object({
    scrape: z
      .object({ available: z.boolean(), reason: z.string().optional() })
      .passthrough()
      .optional(),
    grade: z
      .object({ available: z.boolean(), reason: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export const WidgetDataSchema = z.object({
  status: z.enum(["loading", "ready", "unavailable"]),
  newJobs: z.number().int().nonnegative(),
  totalJobs: z.number().int().nonnegative(),
  running: z.boolean(),
  scraperBoard: BoardCoverageSchema,
  message: z.string().optional(),
  scrapeUnavailableReason: z.string().optional(),
});
export type WaterlooWorksWidgetData = z.infer<typeof WidgetDataSchema>;
export const jobKey = (entry: JobEntry): string =>
  `${entry.board}:${entry.job.id}`;
export const isActiveRun = (run: Run): boolean =>
  ["starting", "queued", "running", "cancelling"].includes(run.status);
export const unrankedCount = (jobs: readonly JobEntry[]): number =>
  jobs.filter((entry) => entry.board === "Co-op" && entry.rating == null)
    .length;
