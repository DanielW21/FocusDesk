import {
  displayText,
  escapeHtml as esc,
  filterJobs,
  payLabel,
  safeUrl,
  sanitizeDescription,
  type JobFilters,
} from "./job-logic";
import {
  isActiveRun,
  jobKey,
  unrankedCount,
  type Capabilities,
  type JobEntry,
  type PageConfig,
  type Run,
} from "./model";
import { formatWaterlooWorksDate } from "./date-utils";

export type PageTab = "review" | "jobs" | "ratings" | "activity";
export interface PageState {
  jobs: JobEntry[];
  runs: Run[];
  capabilities?: Capabilities;
  status: "loading" | "ready" | "unavailable";
  loading: boolean;
  error?: string;
  activityError?: string;
  configError?: string;
  tab: PageTab;
  config: PageConfig;
  filters: JobFilters;
  ratingsFilters: JobFilters;
  page: number;
  ratingsPage: number;
  reviewKey?: string;
  drawerKey?: string;
  expanded: boolean;
  saving: boolean;
  runningAction: boolean;
  clearConfirmation: boolean;
  preview: boolean;
}
export const PAGE_SIZE = 50;
const names = ["Ignore", "Maybe", "Not bad", "Good", "Excellent"];
const label = (text: string): string =>
  text.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const date = formatWaterlooWorksDate;
function button(
  action: string,
  text: string,
  disabled = false,
  extra = "",
): string {
  return `<button type="button" data-ww-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${text}</button>`;
}
function stat(value: number, text: string): string {
  return `<div class="ww-stat"><strong>${value}</strong><span>${esc(text)}</span></div>`;
}
function select(
  field: string,
  title: string,
  value: string,
  choices: readonly (readonly [string, string])[],
  attribute = "filter",
): string {
  return `<label>${esc(title)}<select data-ww-${attribute}="${field}">${choices.map(([key, text]) => `<option value="${esc(key)}" ${key === value ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
}
function input(
  field: string,
  title: string,
  value: string,
  type = "number",
  extra = "",
): string {
  return `<label>${esc(title)}<input data-ww-filter="${field}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function filters(state: PageState, ratings = false): string {
  const f = ratings ? state.ratingsFilters : state.filters;
  const categories = [
    ...new Set(
      state.jobs.flatMap((j) => Object.keys(j.grade?.categoryScores ?? {})),
    ),
  ].sort();
  return `<div class="ww-filters">
    ${input("search", "Search title, company or location", f.search, "search", 'placeholder="Search jobs…"')}
    ${input("minimumScore", "Minimum AI score", f.minimumScore, "number", 'min="0" max="100"')}
    ${select("category", "AI category", f.category, [["", "Any category"], ...categories.map((c): [string, string] => [c, label(c)])])}
    ${input("categoryScore", "Minimum category score", f.categoryScore, "number", 'min="0" max="10"')}
    ${select("status", "AI status", f.status, [
      ["all", "Any status"],
      ["graded", "Graded"],
      ["ungraded", "Not graded"],
      ["relevant", "Relevant / review"],
      ["unrelated", "Weak fit / ineligible"],
      ["hard-fail", "Hard constraint failed"],
    ])}
    ${select("rank", "My manual rank", f.rank, [[ratings ? "rated" : "all", ratings ? "All rated" : "Any rank"], ...(!ratings ? [["unrated", "Unranked"] as const] : []), ...names.map((name, i): [string, string] => [String(i + 1), `${i + 1} · ${name}`])])}
    ${input("minimumPay", "Minimum advertised pay", f.minimumPay, "number", 'min="0" step="any"')}
    ${input("deadline", "Deadline on or before", f.deadline, "date")}
    ${select("sort", "Sort by", f.sort, [
      ["ai", "AI score · highest first"],
      ["newest", "Newest seen"],
      ["pay", "Pay · highest first"],
      ["rating", "My rank · highest first"],
      ["category", "Category score"],
      ["deadline", "Deadline · soonest first"],
      ["title", "Title · A–Z"],
    ])}
    ${button("reset-filters", "Reset filters")}
  </div><p class="ww-note">Pay uses advertised amounts; hourly and annual figures are not converted.</p>`;
}
export function reviewJobs(state: PageState): JobEntry[] {
  return filterJobs(
    state.jobs.filter((j) => j.rating == null || jobKey(j) === state.reviewKey),
    state.filters,
  );
}
function rankButtons(
  entry: JobEntry,
  state: PageState,
  drawer = false,
): string {
  const key = esc(jobKey(entry));
  return `<div class="ww-ranks" aria-label="Manual rank">${names.map((name, i) => `<button type="button" data-ww-rank="${i + 1}" data-ww-key="${key}" data-ww-origin="${drawer ? "drawer" : "review"}" aria-pressed="${entry.rating === i + 1}" ${state.saving || state.preview ? "disabled" : ""}><b>${i + 1}</b><span>${name}</span></button>`).join("")}</div>${entry.rating != null ? button("unrank", "Clear this rank", state.saving || state.preview, `data-ww-key="${key}"`) : ""}`;
}
function richDetails(value: unknown, depth = 0, fieldName = ""): string {
  if (value == null) return "";
  if (isDateField(fieldName)) return `<span>${esc(date(value))}</span>`;
  if (depth > 8) return `<p>${esc(displayText(value))}</p>`;
  if (Array.isArray(value))
    return `<ul>${value.map((item) => `<li>${richDetails(item, depth + 1, fieldName)}</li>`).join("")}</ul>`;
  if (typeof value === "object")
    return `<dl class="ww-rich-fields">${Object.entries(value)
      .map(
        ([key, item]) =>
          `<dt>${esc(label(key))}</dt><dd>${richDetails(item, depth + 1, key)}</dd>`,
      )
      .join("")}</dl>`;
  return `<span>${esc(value)}</span>`;
}
function isDateField(fieldName: string): boolean {
  return /(?:deadline|date|time|(?:^|_)at)$/i.test(fieldName);
}
function companyOverview(entry: JobEntry, jobs: JobEntry[]): string {
  const company = displayText(entry.job.company?.name) || "Company not listed";
  const text = `${company} ${entry.job.jobTitle} ${(entry.job.descriptions ?? []).map((d) => d.content).join(" ")}`;
  const domains: [string, RegExp][] = [
    [
      "AI / machine learning",
      /artificial intelligence|machine learning|\bML\b|LLM|agentic/i,
    ],
    ["Healthcare", /healthcare|medical|clinical|biomedical/i],
    ["Biotech / life sciences", /biotech|molecular|genom|protein|pharma/i],
    ["Software / data", /software|backend|cloud|database|\bAPI\b/i],
    ["Research / science", /research|laboratory|scientific|R&D/i],
  ];
  const matches = domains
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
  const scale =
    /alphabet|apple|amazon|microsoft|google|ibm|sap|huawei|sanofi|siemens|deloitte|sun life|sony|canada revenue|health canada/i.test(
      company,
    )
      ? "Likely larger employer"
      : /\b(inc|labs|llc|ventures|technologies|ai|biosciences|startup)\b/i.test(
            company,
          )
        ? "Likely startup / smaller team"
        : "Scale not listed";
  const count = jobs.filter(
    (j) =>
      j.job.company?.name &&
      displayText(j.job.company.name).toLowerCase() === company.toLowerCase(),
  ).length;
  return `<aside class="ww-panel ww-company"><p class="ww-eyebrow">Company snapshot</p><h3>${esc(company)}</h3><p class="ww-muted">${esc(scale)} (inferred)</p><div class="ww-stats">${stat(count, "Co-op postings in inventory")}</div><p>${esc(displayText(entry.job.location?.city) || "Location not listed")} · ${esc(payLabel(entry) || "Pay not listed")}</p><h4>Domains &amp; expertise</h4><div class="ww-pills">${(matches.length ? matches : ["Domain not specified"]).map((name) => `<span>${esc(name)}</span>`).join("")}</div>${entry.grade?.summary?.rationale ? `<h4>AI role overview</h4><p>${esc(displayText(entry.grade.summary.rationale))}</p>` : ""}<div class="ww-links"><a href="https://www.google.com/search?q=${encodeURIComponent(company)}" target="_blank" rel="noopener noreferrer">Search Google ↗</a><a href="https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company)}" target="_blank" rel="noopener noreferrer">Search LinkedIn ↗</a></div><p class="ww-note">Company size and domains are inferred from posting text and may be approximate.</p></aside>`;
}
function jobDetails(entry: JobEntry, state: PageState, drawer = false): string {
  const j = entry.job;
  const g = entry.grade;
  const full = drawer || state.expanded;
  const metrics: [string, unknown][] = [
    ["Openings", j.openings],
    ["Applications", j.applications],
    ["Deadline", date(j.dates?.deadlineAt)],
    ["Pay", payLabel(entry)],
    ["Job type", j.jobType],
    ["Requirements", j.categorizations],
  ];
  return `<article class="ww-panel ww-job-card ${full ? "ww-expanded" : ""}"><div class="ww-toolbar"><span class="ww-eyebrow">Co-op · Job ${esc(j.id)}</span><span class="ww-muted">Seen ${esc(date(entry.lastSeenAt))}</span></div><h2>${esc(j.jobTitle || "Untitled posting")}</h2><p class="ww-muted">${esc(displayText(j.company?.name) || "Company not listed")} · ${esc(displayText(j.location) || "Location not listed")}</p><div class="ww-toolbar"><a href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">Open posting ↗</a>${!drawer ? button("expand", full ? "Compact details" : "Expand details") : ""}</div><div class="ww-ai-score"><strong>${esc(g?.totalScore ?? "—")}<small> / 100</small></strong><span>${esc(displayText(g?.summary?.recommendation) || (g ? "AI graded" : "Not graded"))}</span></div><div class="ww-pills">${Object.entries(
    g?.categoryScores ?? {},
  )
    .map(
      ([key, value]) =>
        `<span>${esc(label(key))} <b>${esc(displayText(value) || "—")}</b></span>`,
    )
    .join("")}</div><div class="ww-metrics">${metrics
    .filter(([, value]) => value != null && value !== "")
    .map(
      ([name, value]) =>
        `<div><b>${esc(displayText(value))}</b><small>${name}</small></div>`,
    )
    .join(
      "",
    )}</div><h3>Your manual rank</h3>${rankButtons(entry, state, drawer)}${g ? `<details class="ww-evaluation"><summary>Full AI evaluation</summary>${richDetails(g)}</details>` : ""}<div class="ww-descriptions">${(j.descriptions ?? []).map((d) => `<section><h3>${esc(d.title || "Details")}</h3><div class="ww-description">${sanitizeDescription(d.content)}</div></section>`).join("") || '<p class="ww-muted">No description was scraped.</p>'}</div>${full ? `<details><summary>Additional posting fields</summary>${richDetails(Object.fromEntries(Object.entries(j).filter(([key]) => !["id", "jobTitle", "descriptions"].includes(key))))}</details>` : '<p class="ww-note">Expand details to read the complete description.</p>'}</article>`;
}
function rows(jobs: JobEntry[]): string {
  return (
    jobs
      .map(
        (entry) =>
          `<button type="button" class="ww-job-row" data-ww-action="detail" data-ww-key="${esc(jobKey(entry))}"><span class="ww-row-title"><b>${esc(entry.job.jobTitle || "Untitled posting")}</b><small>${esc(displayText(entry.job.company?.name) || "Company not listed")} · ${esc(displayText(entry.job.location?.city) || "Location unknown")}</small></span><span>${esc(entry.grade?.totalScore ?? "—")}<small>AI / 100</small></span><span>${esc(payLabel(entry) || "—")}<small>Advertised pay</small></span><span>${entry.rating == null ? "Unranked" : `★ ${entry.rating}`}<small>Manual rank</small></span><span>${esc(date(entry.job.dates?.deadlineAt))}<small>Deadline</small></span></button>`,
      )
      .join("") || '<div class="ww-empty">No jobs match these filters.</div>'
  );
}
function paginated(jobs: JobEntry[], page: number): string {
  const pages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const current = Math.max(0, Math.min(page, pages - 1));
  return `<div class="ww-list">${rows(jobs.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE))}</div><div class="ww-pagination">${button("previous-page", "← Previous", current === 0)}<span>Page ${current + 1} of ${pages} · ${jobs.length} jobs</span>${button("next-page", "Next →", current >= pages - 1)}</div>`;
}
function breakdown(count: number, total: number, name: string): string {
  return `<div class="ww-bar"><span>${esc(name)}</span><meter min="0" max="${Math.max(1, total)}" value="${count}">${count}</meter><b>${count}</b></div>`;
}
function ratingsView(state: PageState): string {
  const jobs = state.jobs;
  const counts = names.map(
    (_, i) => jobs.filter((j) => j.rating === i + 1).length,
  );
  const rated = jobs.filter((j) => j.rating != null);
  const filtered = filterJobs(rated, state.ratingsFilters);
  return `<div class="ww-toolbar"><h2>Ratings &amp; stats</h2>${button("clear-ratings", "Clear Co-op ranks", state.saving || state.preview || !rated.length)}</div>${state.clearConfirmation ? `<div class="ww-alert">Clear all ${rated.length} manual Co-op ranks? These jobs will return to the review queue. ${button("confirm-clear", "Clear ranks", state.saving)} ${button("keep-ratings", "Keep ranks", state.saving)}</div>` : ""}<div class="ww-stats">${stat(jobs.length, "Total jobs")}${stat(unrankedCount(jobs), "Left to rank")}${stat(rated.length, "Ranked")}${stat(counts[4] ?? 0, "Shortlisted (5)")}</div><div class="ww-columns"><section class="ww-panel"><h3>By manual rank</h3>${counts.map((n, i) => breakdown(n, jobs.length, `${i + 1} · ${names[i]}`)).join("")}</section><section class="ww-panel"><h3>AI classification</h3>${[
    [
      "Relevant",
      jobs.filter((j) => j.grade?.relevantCandidate === true).length,
    ],
    [
      "Not relevant",
      jobs.filter((j) => j.grade?.relevantCandidate === false).length,
    ],
    ["Not graded", jobs.filter((j) => !j.grade).length],
  ]
    .map(([name, count]) => breakdown(Number(count), jobs.length, String(name)))
    .join(
      "",
    )}${["strong-interest", "review", "weak-fit", "ineligible"].map((name) => breakdown(jobs.filter((j) => j.grade?.summary?.recommendation === name).length, jobs.length, name)).join("")}<p class="ww-note">AI classifications do not change your manual ranks.</p></section></div><h3>Rated jobs</h3>${filters(state, true)}<details class="ww-shortlist" open><summary>Shortlist · rank 5 (${filtered.filter((j) => j.rating === 5).length} matching)</summary>${rows(filtered.filter((j) => j.rating === 5))}</details>${paginated(filtered, state.ratingsPage)}`;
}
function activityView(state: PageState): string {
  const busy = state.runningAction || state.runs.some(isActiveRun);
  return `<h2>Activity</h2><section class="ww-panel"><h3>Run tools</h3><p>Scraping discovers postings. Grading evaluates saved Co-op jobs. Start each run explicitly.</p><div class="ww-toolbar">${select(
    "scraperBoard",
    "Scraper board coverage (page and widget)",
    state.config.scraperBoard,
    [
      ["coop", "Co-op"],
      ["direct", "Employer-Student Direct"],
      ["both", "Co-op + Employer-Student Direct"],
    ],
    "config",
  )}${button("scrape", "Run scraper", busy || state.capabilities?.scrape?.available === false)}${button("grade", "Grade Co-op jobs", busy || state.capabilities?.grade?.available === false)}${button("refresh", "Refresh activity", state.loading)}</div><p class="ww-note">Review, filters, ratings and the widget count always show Co-op jobs.</p>${[
    state.capabilities?.scrape,
    state.capabilities?.grade,
  ]
    .filter((c) => c?.available === false)
    .map(
      (c) =>
        `<p class="ww-alert">${esc(c?.reason || "This tool is unavailable.")}</p>`,
    )
    .join(
      "",
    )}</section>${state.activityError ? `<p class="ww-alert" role="status">Activity unavailable: ${esc(state.activityError)}</p>` : ""}<h3>Runs</h3>${state.runs.length ? state.runs.map((run) => `<article class="ww-panel ww-run"><div class="ww-toolbar"><b>${esc(run.type ?? run.kind ?? "Run")}</b><span>${esc(run.status)}</span></div><small>${esc(run.id)} · ${esc(date(run.createdAt))}</small><p>${esc(run.message ?? "")}</p><details><summary>Run details</summary>${richDetails(run)}</details>${isActiveRun(run) ? button("cancel-run", run.status === "cancelling" ? "Cancelling…" : "Cancel run", state.runningAction || run.status === "cancelling", `data-ww-run="${esc(run.id)}"`) : ""}</article>`).join("") : '<p class="ww-empty">No recorded runs are available.</p>'}`;
}
export function renderPage(state: PageState): string {
  let content: string;
  if (state.tab === "activity") content = activityView(state);
  else if (state.status === "loading")
    content =
      '<div class="ww-empty" role="status">Loading saved Co-op jobs…</div>';
  else if (state.status === "unavailable" && !state.jobs.length)
    content = `<div class="ww-empty"><h2>WaterlooWorks service unavailable</h2><p>Saved jobs could not be loaded. Retry when the native service is available.</p>${button("refresh", "Retry", state.loading)}</div>`;
  else if (state.tab === "ratings") content = ratingsView(state);
  else if (state.tab === "jobs")
    content = `<h2>All Co-op jobs</h2>${filters(state)}${paginated(filterJobs(state.jobs, state.filters), state.page)}`;
  else {
    const queue = reviewJobs(state);
    const entry = queue.find((j) => jobKey(j) === state.reviewKey) ?? queue[0];
    const position = entry ? queue.indexOf(entry) : 0;
    content = `<div class="ww-toolbar"><h2>Review <span class="ww-muted">${unrankedCount(state.jobs)} left to rank</span></h2><div class="ww-toggles"><label><input type="checkbox" data-ww-config="keyboard" ${state.config.keyboard ? "checked" : ""}> Keyboard shortcuts</label><label><input type="checkbox" data-ww-config="autoNext" ${state.config.autoNext ? "checked" : ""}> Auto-next after ranking</label></div></div><details class="ww-review-filters"><summary>Filter review queue</summary>${filters(state)}</details>${entry ? `<div class="ww-toolbar">${button("previous", "← Previous", position <= 0)}<span>${position + 1} / ${queue.length}${entry.rating != null ? ` · Saved rank ${entry.rating}` : ""}</span>${button("next", "Next →", position >= queue.length - 1)}</div><div class="ww-review-layout">${jobDetails(entry, state)}${companyOverview(entry, state.jobs)}</div><p class="ww-note">Shortcuts: 1–5 rank · J/K or arrows navigate · E expands · Escape compacts. Shortcuts pause while typing.</p>` : `<div class="ww-empty"><h3>${unrankedCount(state.jobs) ? "No unranked jobs match these filters" : "Your review queue is clear"}</h3><p>New and imported jobs stay here until you manually rank them.</p>${button("tab-jobs", "Browse all jobs")}</div>`}`;
  }
  const drawer = state.jobs.find((j) => jobKey(j) === state.drawerKey);
  return `<section class="ww-page" data-ww-page tabindex="-1"><header class="ww-header"><div><p class="ww-eyebrow">Your next opportunity</p><h1>WaterlooWorks</h1><p class="ww-muted">Co-op inventory · review at your pace</p></div>${button("refresh", state.loading ? "Refreshing…" : "Refresh saved data", state.loading)}</header><nav class="ww-tabs" aria-label="WaterlooWorks sections">${(
    [
      ["review", "Review"],
      ["jobs", "All jobs"],
      ["ratings", "Ratings & stats"],
      ["activity", "Activity"],
    ] as const
  )
    .map(([tab, text]) =>
      button(
        `tab-${tab}`,
        esc(text),
        false,
        `aria-current="${state.tab === tab ? "page" : "false"}"`,
      ),
    )
    .join(
      "",
    )}</nav>${state.error ? `<div class="ww-alert" role="alert">${esc(state.error)}</div>` : ""}${state.status === "unavailable" && state.jobs.length ? '<p class="ww-alert">Showing previously loaded jobs. The current service state could not be verified.</p>' : ""}${state.configError ? `<p class="ww-alert" role="alert">${esc(state.configError)}</p>` : ""}${state.preview ? `<p class="ww-alert">Local JSON preview. Ranking is disabled until you return to saved jobs. ${button("refresh", "Return to saved jobs")}</p>` : ""}<div class="ww-tab-content">${content}</div><footer class="ww-page-footer"><label>Preview a jobs JSON export <input type="file" accept="application/json,.json" data-ww-import></label><span class="ww-note">Preview stays on this device; it does not import into the database.</span></footer>${drawer ? `<div class="ww-drawer-backdrop" data-ww-backdrop><aside class="ww-drawer" role="dialog" aria-modal="true" aria-label="Job details" tabindex="-1">${button("close-drawer", "Close details ×")}${jobDetails(drawer, state, true)}${companyOverview(drawer, state.jobs)}</aside></div>` : ""}</section>`;
}
