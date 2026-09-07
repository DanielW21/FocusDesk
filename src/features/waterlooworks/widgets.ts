import type {
  WidgetDimension,
  WidgetRenderContext,
  WidgetView,
} from "../../contracts/widgets";
import { defineWidget } from "../../widgets/define-widget";
import { visualHeight } from "../../widgets/widget-dimensions";
import { escapeHtml as esc } from "./job-logic";
import { WidgetDataSchema } from "./model";

export function renderWaterlooWorksWidget(
  context: WidgetRenderContext,
  dimension: WidgetDimension,
): string {
  const raw = context.data;
  const result = WidgetDataSchema.safeParse(
    raw && typeof raw === "object" && "waterlooWorks" in raw
      ? raw.waterlooWorks
      : undefined,
  );
  const data = result.success ? result.data : undefined;
  const ready = data?.status === "ready";
  const title = ready
    ? `${data.newJobs}`
    : data?.status === "loading" || !data
      ? "…"
      : "—";
  const status = ready
    ? "new jobs to rank"
    : data?.status === "loading" || !data
      ? "Loading saved jobs"
      : "Service unavailable";
  const compact = dimension === "2x1";
  return `<div class="ww-widget ${compact ? "ww-widget-compact" : ""}" data-ww-widget="show" role="button" tabindex="0" aria-label="Open WaterlooWorks review"><div class="ww-widget-count"><strong>${title}</strong><span>${status}</span></div>${!compact && ready ? `<p class="ww-note">${data.totalJobs} Co-op jobs · unranked jobs stay in your queue across scrapes.</p>` : ""}<button type="button" data-ww-widget="run" ${data?.running || data?.scrapeUnavailableReason ? "disabled" : ""} title="${esc(data?.scrapeUnavailableReason ?? `Scrape ${data?.scraperBoard ?? "coop"}`)}">${data?.running ? "Run in progress…" : "Run scraper"}</button>${data?.message ? `<p class="ww-widget-message" role="status">${esc(data.message)}</p>` : ""}${data?.scrapeUnavailableReason && !compact ? `<p class="ww-note">${esc(data.scrapeUnavailableReason)}</p>` : ""}</div>`;
}
const views: Partial<Record<WidgetDimension, WidgetView>> = {};
for (const dimension of ["2x1", "2x2", "4x2"] as const)
  views[dimension] = {
    render: (context) => renderWaterlooWorksWidget(context, dimension),
    minimumHeight: visualHeight(dimension),
  };
export const waterlooWorksJobsWidget = defineWidget({
  id: "waterlooworks.jobs",
  featureId: "waterlooworks",
  title: "WaterlooWorks",
  description: "New Co-op jobs awaiting your manual rank",
  icon: "↗",
  defaultDimension: "2x1",
  capabilities: ["read-data", "mutate-data", "start-process", "network-access"],
  views,
});
