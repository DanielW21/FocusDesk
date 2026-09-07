import type { JobEntry } from "./model";
import { timestampFromWaterlooWorks } from "./date-utils";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}
export function safeUrl(value: unknown): string {
  const text = String(value ?? "").trim();
  const containsControlCharacter = [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
  return /^(https?:\/\/|mailto:)/i.test(text) && !containsControlCharacter
    ? text
    : "#";
}
export function sanitizeDescription(value: unknown): string {
  if (typeof document === "undefined") return escapeHtml(value);
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "");
  const allowed = new Set([
    "a",
    "b",
    "br",
    "strong",
    "em",
    "i",
    "u",
    "p",
    "div",
    "span",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "pre",
    "code",
  ]);
  const blocked = new Set([
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "template",
  ]);
  const render = (node: Node): string => {
    if (node.nodeType === 3) return escapeHtml(node.nodeValue);
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (blocked.has(tag)) return "";
    const children = Array.from(node.childNodes, render).join("");
    if (!allowed.has(tag)) return children;
    if (tag === "a")
      return `<a href="${escapeHtml(safeUrl(element.getAttribute("href")))}" target="_blank" rel="noopener noreferrer">${children}</a>`;
    return tag === "br" ? "<br>" : `<${tag}>${children}</${tag}>`;
  };
  return Array.from(template.content.childNodes, render).join("");
}
export function displayText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(displayText).join(", ");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${displayText(item)}`)
      .join(" · ");
  return String(value);
}
export function payLabel(entry: JobEntry): string {
  const salaries = Object.values(entry.job.salaries ?? {}).flatMap((value) => {
    const raw =
      value && typeof value === "object" && "amount" in value
        ? value.amount
        : value;
    const amount = Number.parseFloat(String(raw).replace(/[$,]/g, ""));
    return Number.isFinite(amount) ? [amount] : [];
  });
  if (salaries.length)
    return `$${Math.max(...salaries).toLocaleString("en-CA")}`;
  for (const d of entry.job.descriptions ?? []) {
    if (!/compensation|salary|pay|wage/i.test(d.title ?? "")) continue;
    const match = (d.content ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .match(
        /(?:CA\$|CAD\s*|\$)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:-|–|—|to)\s*(?:CA\$|CAD\s*|\$)?\s*\d[\d,]*(?:\.\d+)?)?(?:\s*(?:\/\s*(?:hr|hour)|per\s+hour|hourly))?/i,
      );
    if (match) return match[0];
  }
  return "";
}
export function payValue(entry: JobEntry): number {
  const values = (payLabel(entry).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((v) =>
    Number(v.replace(/,/g, "")),
  );
  return values.length ? Math.max(...values) : 0;
}
export interface JobFilters {
  search: string;
  minimumScore: string;
  category: string;
  categoryScore: string;
  status: string;
  rank: string;
  minimumPay: string;
  deadline: string;
  sort: string;
}
export const defaultFilters = (): JobFilters => ({
  search: "",
  minimumScore: "",
  category: "",
  categoryScore: "",
  status: "all",
  rank: "all",
  minimumPay: "",
  deadline: "",
  sort: "ai",
});
export function filterJobs(
  jobs: readonly JobEntry[],
  filters: JobFilters,
): JobEntry[] {
  const f = filters;
  return jobs
    .filter((entry) => {
      const { job, grade, rating } = entry;
      if (
        f.search &&
        !`${job.id} ${job.jobTitle} ${displayText(job.company)} ${displayText(job.location)}`
          .toLowerCase()
          .includes(f.search.trim().toLowerCase())
      )
        return false;
      if (
        f.minimumScore !== "" &&
        (grade?.totalScore == null || grade.totalScore < Number(f.minimumScore))
      )
        return false;
      const category = grade?.categoryScores?.[f.category];
      if (f.category && typeof category !== "number") return false;
      if (
        f.categoryScore !== "" &&
        (typeof category !== "number" || category < Number(f.categoryScore))
      )
        return false;
      const weak =
        grade?.relevantCandidate === false ||
        ["weak-fit", "ineligible"].includes(
          String(grade?.summary?.recommendation),
        );
      if (
        (f.status === "graded" && !grade) ||
        (f.status === "ungraded" && grade) ||
        (f.status === "relevant" && (!grade || weak)) ||
        (f.status === "unrelated" && !weak)
      )
        return false;
      if (
        f.status === "hard-fail" &&
        !(
          Array.isArray(grade?.hardConstraints) &&
          grade.hardConstraints.some(
            (c: unknown) =>
              c !== null &&
              typeof c === "object" &&
              "status" in c &&
              c.status === "fail",
          )
        )
      )
        return false;
      if (
        (f.rank === "unrated" && rating != null) ||
        (f.rank === "rated" && rating == null) ||
        (!["all", "rated", "unrated"].includes(f.rank) &&
          rating !== Number(f.rank))
      )
        return false;
      if (
        f.minimumPay !== "" &&
        (!payLabel(entry) || payValue(entry) < Number(f.minimumPay))
      )
        return false;
      if (
        f.deadline &&
        (!Number.isFinite(timestampFromWaterlooWorks(job.dates?.deadlineAt)) ||
          timestampFromWaterlooWorks(job.dates?.deadlineAt) >
            timestampFromWaterlooWorks(`${f.deadline}T23:59:59`))
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      if (f.sort === "title")
        return (a.job.jobTitle ?? "").localeCompare(b.job.jobTitle ?? "");
      if (f.sort === "deadline")
        return (
          (timestampFromWaterlooWorks(a.job.dates?.deadlineAt) || Infinity) -
          (timestampFromWaterlooWorks(b.job.dates?.deadlineAt) || Infinity)
        );
      const value = (entry: JobEntry): number =>
        f.sort === "pay"
          ? payValue(entry)
          : f.sort === "rating"
            ? (entry.rating ?? 0)
            : f.sort === "category"
              ? Number(entry.grade?.categoryScores?.[f.category]) || 0
              : f.sort === "newest"
                ? timestampFromWaterlooWorks(entry.lastSeenAt) || 0
                : (entry.grade?.totalScore ?? -1);
      return value(b) - value(a);
    });
}
export interface ReviewKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}
export function reviewKeyboardAction(
  event: ReviewKey,
  tab: string,
  enabled: boolean,
  editing: boolean,
  drawerOpen: boolean,
): string | null {
  if (
    tab !== "review" ||
    !enabled ||
    editing ||
    drawerOpen ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.repeat ||
    event.isComposing
  )
    return null;
  if (/^[1-5]$/.test(event.key)) return `rank:${event.key}`;
  if (["ArrowDown", "j", "r"].includes(event.key)) return "next";
  if (["ArrowUp", "k", "w"].includes(event.key)) return "previous";
  return event.key === "e"
    ? "expand"
    : event.key === "Escape"
      ? "compact"
      : null;
}
