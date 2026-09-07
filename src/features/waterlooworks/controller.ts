import {
  defaultFilters,
  filterJobs,
  reviewKeyboardAction,
  type JobFilters,
} from "./job-logic";
import {
  createWaterlooWorksClient,
  type WaterlooWorksClient,
} from "./native-client";
import {
  JobEntrySchema,
  PageConfigSchema,
  RankSchema,
  isActiveRun,
  jobKey,
  unrankedCount,
  type PageConfig,
  type Run,
  type WaterlooWorksWidgetData,
} from "./model";
import {
  PAGE_SIZE,
  renderPage,
  reviewJobs,
  type PageState,
  type PageTab,
} from "./views";

const CONFIG_KEY = "focusdesk.waterlooworks.page-config.v1";
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export interface WaterlooWorksControllerOptions {
  client?: WaterlooWorksClient;
  config?: Partial<PageConfig>;
  getConfig?: () => PageConfig;
  onConfigChange?: (config: PageConfig) => void | Promise<void>;
  onChange?: () => void;
  onNavigate?: () => void;
}
export function createWaterlooWorksController(
  options: WaterlooWorksControllerOptions = {},
) {
  const client = options.client ?? createWaterlooWorksClient();
  const state: PageState = {
    jobs: [],
    runs: [],
    status: "loading",
    loading: false,
    tab: "review",
    config: PageConfigSchema.parse(options.config ?? {}),
    filters: defaultFilters(),
    ratingsFilters: { ...defaultFilters(), rank: "rated", sort: "rating" },
    page: 0,
    ratingsPage: 0,
    expanded: false,
    saving: false,
    runningAction: false,
    clearConfirmation: false,
    preview: false,
  };
  let pageBinding:
    | { container: HTMLElement; dispose: () => void; onChange?: () => void }
    | undefined;
  const widgetBindings = new Map<
    HTMLElement,
    { dispose: () => void; onChange?: () => void }
  >();
  let polling: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<void> | undefined;
  let initialized = false;
  let disposed = false;
  let revision = 0;
  let drawerOpenerKey: string | undefined;

  function notify(): void {
    if (disposed) return;
    const callbacks = new Set([
      options.onChange,
      pageBinding?.onChange,
      ...[...widgetBindings.values()].map((b) => b.onChange),
    ]);
    for (const callback of callbacks) callback?.();
  }
  function readConfig(): void {
    try {
      if (options.getConfig)
        state.config = PageConfigSchema.parse(options.getConfig());
      else if (!initialized && typeof localStorage !== "undefined") {
        const stored = localStorage.getItem(CONFIG_KEY);
        if (stored) state.config = PageConfigSchema.parse(JSON.parse(stored));
      }
    } catch (error) {
      state.configError = `Could not load page settings: ${message(error)}`;
    }
  }
  function selectReview(): void {
    const queue = reviewJobs(state);
    if (!queue.some((j) => jobKey(j) === state.reviewKey))
      state.reviewKey = queue[0] ? jobKey(queue[0]) : undefined;
  }
  function schedulePoll(): void {
    if (polling) clearTimeout(polling);
    if (
      !disposed &&
      !state.preview &&
      state.runs.some(isActiveRun) &&
      !state.activityError
    ) {
      polling = setTimeout(() => {
        void refresh();
      }, 3000);
    }
  }
  async function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    disposed = false;
    refreshing = (async () => {
      state.loading = true;
      const startingRevision = revision;
      notify();
      const [jobs, capabilities, runs] = await Promise.allSettled([
        client.jobs(),
        client.capabilities(),
        client.runs(),
      ]);
      if (disposed) return;
      if (jobs.status === "fulfilled") {
        if (startingRevision === revision) {
          state.jobs = jobs.value;
          state.preview = false;
          selectReview();
        }
        state.status = "ready";
        // Save failures stay visible until the user retries that operation.
        if (state.error?.startsWith("Could not load jobs:"))
          state.error = undefined;
      } else {
        state.status = "unavailable";
        state.error = `Could not load jobs: ${message(jobs.reason)}`;
      }
      const activityErrors: string[] = [];
      if (capabilities.status === "fulfilled")
        state.capabilities = capabilities.value;
      else activityErrors.push(`Capabilities: ${message(capabilities.reason)}`);
      if (runs.status === "fulfilled") state.runs = runs.value;
      else activityErrors.push(`Runs: ${message(runs.reason)}`);
      state.activityError = activityErrors.length
        ? activityErrors.join(" · ")
        : undefined;
      state.loading = false;
      notify();
      schedulePoll();
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }
  async function initialize(): Promise<void> {
    disposed = false;
    if (initialized) return refreshing;
    readConfig();
    initialized = true;
    await refresh();
  }
  async function updateConfig(patch: Partial<PageConfig>): Promise<void> {
    const previous = state.config;
    try {
      const next = PageConfigSchema.parse({ ...previous, ...patch });
      state.config = next;
      if (options.onConfigChange) await options.onConfigChange(next);
      else if (typeof localStorage !== "undefined")
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      state.configError = undefined;
    } catch (error) {
      state.config = previous;
      state.configError = `Could not save page settings: ${message(error)}`;
    }
    notify();
  }
  function move(direction: number): void {
    const queue = reviewJobs(state);
    const current = queue.findIndex((j) => jobKey(j) === state.reviewKey);
    const next =
      queue[Math.max(0, Math.min(queue.length - 1, current + direction))];
    state.reviewKey = next ? jobKey(next) : undefined;
    notify();
  }
  async function saveRating(
    key: string,
    rank: number | null,
    origin = "review",
  ): Promise<void> {
    if (state.saving || state.preview) return;
    const entry = state.jobs.find((j) => jobKey(j) === key);
    if (!entry) return;
    RankSchema.nullable().parse(rank);
    const queue = reviewJobs(state);
    const position = queue.findIndex((j) => jobKey(j) === key);
    state.saving = true;
    notify();
    try {
      await client.saveRating(key, rank);
      revision++;
      const latest = state.jobs.find((j) => jobKey(j) === key);
      if (latest) latest.rating = rank;
      state.error = undefined;
      if (origin === "review" && rank !== null && state.config.autoNext) {
        const remaining = queue.filter(
          (j) => jobKey(j) !== key && j.rating == null,
        );
        const next =
          remaining[Math.min(Math.max(position, 0), remaining.length - 1)];
        state.reviewKey = next ? jobKey(next) : undefined;
      }
      selectReview();
    } catch (error) {
      state.error = `Rank was not saved: ${message(error)}`;
    } finally {
      state.saving = false;
      notify();
    }
  }
  async function clearRatings(): Promise<void> {
    if (state.saving || state.preview || !state.clearConfirmation) return;
    state.saving = true;
    notify();
    try {
      for (const entry of state.jobs.filter((j) => j.rating != null)) {
        await client.saveRating(jobKey(entry), null);
        revision++;
        const latest = state.jobs.find((j) => jobKey(j) === jobKey(entry));
        if (latest) latest.rating = null;
      }
      state.error = undefined;
    } catch (error) {
      state.error = `Could not clear every rank: ${message(error)}. Confirmed changes were kept; remaining ranks are still shown.`;
    } finally {
      state.clearConfirmation = false;
      state.saving = false;
      selectReview();
      notify();
    }
  }
  function putRun(run: Run): void {
    state.runs = [run, ...state.runs.filter((r) => r.id !== run.id)];
  }
  async function runAction(
    action: "scrape" | "grade" | "cancel",
    id?: string,
  ): Promise<void> {
    if (
      state.runningAction ||
      (action !== "cancel" && state.runs.some(isActiveRun))
    )
      return;
    readConfig();
    const capability =
      action === "scrape"
        ? state.capabilities?.scrape
        : action === "grade"
          ? state.capabilities?.grade
          : undefined;
    if (capability?.available === false) {
      state.error = capability.reason ?? `${action} is unavailable.`;
      notify();
      return;
    }
    state.runningAction = true;
    notify();
    try {
      const run =
        action === "scrape"
          ? await client.startScrape(state.config.scraperBoard)
          : action === "grade"
            ? await client.startGrade()
            : await client.cancelRun(id ?? "");
      putRun(run);
      state.error = undefined;
      state.activityError = undefined;
    } catch (error) {
      state.error = `Could not ${action === "cancel" ? "cancel run" : `start ${action}`}: ${message(error)}`;
    } finally {
      state.runningAction = false;
      notify();
      schedulePoll();
    }
  }
  function closeDrawer(): void {
    state.drawerKey = undefined;
    notify();
    const opener = Array.from(
      pageBinding?.container.querySelectorAll<HTMLElement>(
        '[data-ww-action="detail"]',
      ) ?? [],
    ).find((el) => el.dataset.wwKey === drawerOpenerKey);
    (
      opener ??
      pageBinding?.container.querySelector<HTMLElement>("[data-ww-page]")
    )?.focus();
  }
  async function action(name: string, element?: HTMLElement): Promise<void> {
    if (name.startsWith("tab-")) {
      const tab = name.slice(4);
      if (["review", "jobs", "ratings", "activity"].includes(tab)) {
        state.tab = tab as PageTab;
        state.drawerKey = undefined;
        selectReview();
      }
    } else if (name === "refresh") {
      await refresh();
      return;
    } else if (name === "next" || name === "previous") {
      move(name === "next" ? 1 : -1);
      return;
    } else if (name === "expand") state.expanded = !state.expanded;
    else if (name === "compact") state.expanded = false;
    else if (name === "reset-filters") {
      if (state.tab === "ratings")
        state.ratingsFilters = {
          ...defaultFilters(),
          rank: "rated",
          sort: "rating",
        };
      else state.filters = defaultFilters();
      state.page = state.ratingsPage = 0;
      selectReview();
    } else if (name === "detail") {
      state.drawerKey = element?.dataset.wwKey;
      drawerOpenerKey = state.drawerKey;
    } else if (name === "close-drawer") {
      closeDrawer();
      return;
    } else if (name === "unrank") {
      await saveRating(element?.dataset.wwKey ?? "", null, "drawer");
      return;
    } else if (name === "clear-ratings") state.clearConfirmation = true;
    else if (name === "keep-ratings") state.clearConfirmation = false;
    else if (name === "confirm-clear") {
      await clearRatings();
      return;
    } else if (name === "scrape" || name === "grade") {
      await runAction(name);
      return;
    } else if (name === "cancel-run") {
      await runAction("cancel", element?.dataset.wwRun);
      return;
    } else if (name === "next-page" || name === "previous-page") {
      const ratings = state.tab === "ratings";
      const count = filterJobs(
        ratings ? state.jobs.filter((j) => j.rating != null) : state.jobs,
        ratings ? state.ratingsFilters : state.filters,
      ).length;
      const current = ratings ? state.ratingsPage : state.page;
      const next = Math.max(
        0,
        Math.min(
          Math.max(0, Math.ceil(count / PAGE_SIZE) - 1),
          current + (name === "next-page" ? 1 : -1),
        ),
      );
      if (ratings) state.ratingsPage = next;
      else state.page = next;
    }
    notify();
    if (name === "detail")
      pageBinding?.container.querySelector<HTMLElement>(".ww-drawer")?.focus();
  }
  function bind(container: HTMLElement, onChange?: () => void): void {
    pageBinding?.dispose();
    const click = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-ww-page]")) return;
      if (target.hasAttribute("data-ww-backdrop")) {
        closeDrawer();
        return;
      }
      const rank = target.closest<HTMLElement>("[data-ww-rank]");
      const control = target.closest<HTMLElement>("[data-ww-action]");
      if (rank || control) event.stopPropagation();
      if (rank)
        void saveRating(
          rank.dataset.wwKey ?? "",
          Number(rank.dataset.wwRank),
          rank.dataset.wwOrigin,
        );
      else if (control) void action(control.dataset.wwAction ?? "", control);
    };
    const input = (event: Event): void => {
      const el = event.target;
      if (
        !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement) ||
        !el.closest("[data-ww-page]")
      )
        return;
      const field = el.dataset.wwFilter;
      if (field && field in state.filters) {
        const f =
          state.tab === "ratings" ? state.ratingsFilters : state.filters;
        f[field as keyof JobFilters] = el.value;
        state.page = state.ratingsPage = 0;
        selectReview();
        const start =
          el instanceof HTMLInputElement && ["search", "text"].includes(el.type)
            ? el.selectionStart
            : null;
        notify();
        const replacement = container.querySelector<
          HTMLInputElement | HTMLSelectElement
        >(`[data-ww-filter="${field}"]`);
        replacement?.focus();
        if (replacement instanceof HTMLInputElement && start !== null)
          replacement.setSelectionRange(start, start);
      }
    };
    const change = (event: Event): void => {
      const el = event.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement))
        return;
      const config = el.dataset.wwConfig;
      if (config === "scraperBoard")
        void updateConfig({
          scraperBoard: el.value as PageConfig["scraperBoard"],
        });
      else if (config === "autoNext" || config === "keyboard")
        void updateConfig({ [config]: (el as HTMLInputElement).checked });
      if (
        el instanceof HTMLInputElement &&
        el.hasAttribute("data-ww-import") &&
        el.files?.[0]
      ) {
        const file = el.files[0];
        void (async () => {
          try {
            if (file.size > 30_000_000)
              throw new Error("Choose a JSON export under 30 MB.");
            const payload: unknown = JSON.parse(await file.text());
            const entries = Array.isArray(payload)
              ? payload
              : payload && typeof payload === "object" && "jobs" in payload
                ? payload.jobs
                : undefined;
            state.jobs = JobEntrySchema.array()
              .parse(entries)
              .filter((j) => j.board === "Co-op");
            revision++;
            state.preview = true;
            state.status = "ready";
            state.error = undefined;
            state.reviewKey = undefined;
            selectReview();
            schedulePoll();
          } catch (error) {
            state.error = `Could not preview export: ${message(error)}`;
          }
          notify();
        })();
      }
    };
    const keydown = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-ww-page]")) return;
      if (state.drawerKey) {
        if (event.key === "Escape" && !event.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          closeDrawer();
        }
        if (event.key === "Tab") {
          const elements = Array.from(
            container.querySelectorAll<HTMLElement>(
              ".ww-drawer button:not(:disabled), .ww-drawer a[href], .ww-drawer input, .ww-drawer select, .ww-drawer summary",
            ),
          );
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (
            event.shiftKey &&
            (target === first || target.classList.contains("ww-drawer"))
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && target === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        return;
      }
      const editing = !!target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]',
      );
      const result = reviewKeyboardAction(
        event,
        state.tab,
        state.config.keyboard,
        editing,
        false,
      );
      if (!result) return;
      event.preventDefault();
      event.stopPropagation();
      if (result.startsWith("rank:")) {
        const entry = reviewJobs(state).find(
          (j) => jobKey(j) === state.reviewKey,
        );
        if (entry) void saveRating(jobKey(entry), Number(result.slice(5)));
      } else void action(result);
    };
    container.addEventListener("click", click);
    container.addEventListener("input", input);
    container.addEventListener("change", change);
    container.addEventListener("keydown", keydown);
    pageBinding = {
      container,
      onChange,
      dispose: () => {
        container.removeEventListener("click", click);
        container.removeEventListener("input", input);
        container.removeEventListener("change", change);
        container.removeEventListener("keydown", keydown);
      },
    };
  }
  function widgetData(): WaterlooWorksWidgetData {
    readConfig();
    return {
      status: state.preview ? "unavailable" : state.status,
      newJobs: state.preview ? 0 : unrankedCount(state.jobs),
      totalJobs: state.preview ? 0 : state.jobs.length,
      running: state.runningAction || state.runs.some(isActiveRun),
      scraperBoard: state.config.scraperBoard,
      message: state.preview
        ? "Return to saved jobs to see the queue count."
        : state.error,
      scrapeUnavailableReason:
        state.capabilities?.scrape?.available === false
          ? (state.capabilities.scrape.reason ?? "Scraper unavailable")
          : undefined,
    };
  }
  function handleWidgetShow(
    openPage: () => void = options.onNavigate ?? (() => undefined),
  ): void {
    state.tab = "review";
    state.drawerKey = undefined;
    selectReview();
    openPage();
    notify();
  }
  async function handleWidgetRun(): Promise<void> {
    await runAction("scrape");
  }
  function bindWidget(
    container: HTMLElement,
    openPage?: () => void,
    onChange?: () => void,
  ): void {
    widgetBindings.get(container)?.dispose();
    for (const [element, binding] of widgetBindings)
      if (!element.isConnected && element !== container) {
        binding.dispose();
        widgetBindings.delete(element);
      }
    const click = (event: MouseEvent): void => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-ww-widget]")
          : null;
      if (!target || !container.contains(target)) return;
      event.stopPropagation();
      if (target.dataset.wwWidget === "run") void handleWidgetRun();
      else handleWidgetShow(openPage);
    };
    const keydown = (event: KeyboardEvent): void => {
      const el = event.target;
      if (
        el instanceof HTMLElement &&
        el.dataset.wwWidget === "show" &&
        ["Enter", " "].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        handleWidgetShow(openPage);
      }
    };
    container.addEventListener("click", click);
    container.addEventListener("keydown", keydown);
    widgetBindings.set(container, {
      onChange,
      dispose: () => {
        container.removeEventListener("click", click);
        container.removeEventListener("keydown", keydown);
      },
    });
  }
  function dispose(): void {
    disposed = true;
    initialized = false;
    if (polling) clearTimeout(polling);
    pageBinding?.dispose();
    pageBinding = undefined;
    for (const binding of widgetBindings.values()) binding.dispose();
    widgetBindings.clear();
  }
  return {
    render: (): string => {
      readConfig();
      return renderPage(state);
    },
    bind,
    initialize,
    refresh,
    widgetData,
    handleWidgetRun,
    handleWidgetShow,
    bindWidget,
    dispose,
    updateConfig,
    saveRating,
  };
}
export type WaterlooWorksController = ReturnType<
  typeof createWaterlooWorksController
>;
export const waterlooWorksController = createWaterlooWorksController();
