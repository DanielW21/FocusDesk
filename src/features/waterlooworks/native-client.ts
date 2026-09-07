import { z } from "zod";
import { invokeNative, type NativeInvoke } from "../../platform/native-bridge";
import {
  BoardCoverageSchema,
  CapabilitiesSchema,
  JobsResponseSchema,
  RankSchema,
  RunSchema,
  jobKey,
  type BoardCoverage,
  type JobEntry,
} from "./model";

const ErrorSchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string() }).passthrough()]),
});
export function createWaterlooWorksClient(invoke: NativeInvoke = invokeNative) {
  async function request<T>(
    method: "GET" | "PUT" | "POST",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const response = await invoke<unknown>("waterlooworks.request", {
      method,
      path,
      body,
    });
    const failure = ErrorSchema.safeParse(response);
    if (failure.success)
      throw new Error(
        typeof failure.data.error === "string"
          ? failure.data.error
          : failure.data.error.message,
      );
    return schema.parse(response);
  }
  return {
    async jobs(): Promise<JobEntry[]> {
      const jobs = new Map<string, JobEntry>();
      const cursors = new Set<string>();
      let cursor: string | null | undefined;
      do {
        const response = await request(
          "GET",
          `/api/v1/jobs?board=Co-op&limit=10000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          JobsResponseSchema,
        );
        for (const entry of response.jobs)
          if (entry.board === "Co-op") jobs.set(jobKey(entry), entry);
        cursor = response.page?.nextCursor;
        if (cursor && cursors.has(cursor))
          throw new Error(
            "The jobs service returned a repeated pagination cursor.",
          );
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return [...jobs.values()];
    },
    capabilities: () =>
      request("GET", "/api/v1/capabilities", CapabilitiesSchema),
    runs: async () =>
      (
        await request(
          "GET",
          "/api/v1/runs",
          z.object({ runs: z.array(RunSchema) }).passthrough(),
        )
      ).runs,
    summary: () =>
      request(
        "GET",
        "/api/v1/summary?board=Co-op",
        z.object({ newJobs: z.number().int().nonnegative() }).passthrough(),
      ),
    async saveRating(key: string, rank: number | null): Promise<void> {
      const rating = RankSchema.nullable().parse(rank);
      const response = await request(
        "PUT",
        `/api/v1/jobs/${encodeURIComponent(key)}/rating`,
        z
          .object({
            rating: z
              .object({ jobKey: z.string(), rating: RankSchema.nullable() })
              .passthrough(),
          })
          .passthrough(),
        { rating },
      );
      if (response.rating.jobKey !== key || response.rating.rating !== rating)
        throw new Error(
          "The service did not confirm the requested rating. Refresh and retry.",
        );
    },
    async startScrape(board: BoardCoverage = "coop") {
      return (
        await request(
          "POST",
          "/api/v1/scrapes",
          z.object({ run: RunSchema }).passthrough(),
          { board: BoardCoverageSchema.parse(board) },
        )
      ).run;
    },
    async startGrade() {
      return (
        await request(
          "POST",
          "/api/v1/grades",
          z.object({ run: RunSchema }).passthrough(),
          { board: "coop" },
        )
      ).run;
    },
    async cancelRun(id: string) {
      return (
        await request(
          "POST",
          `/api/v1/runs/${encodeURIComponent(id)}/cancel`,
          z.object({ run: RunSchema }).passthrough(),
          {},
        )
      ).run;
    },
  };
}
export type WaterlooWorksClient = ReturnType<typeof createWaterlooWorksClient>;
