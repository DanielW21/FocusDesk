import type { AppState } from "../../app/app-state";
import { element } from "../../ui/dom";
import { escapeHtml, formatShort } from "../../ui/formatters";

export interface WorkspaceModalActionsContext {
  state: AppState;
  showModal: (content: string) => void;
}

export interface WorkspaceModalActions {
  openSearch: () => void;
  openFocus: (taskId: number) => void;
  stopTimer: () => void;
}

export function createWorkspaceModalActions(
  context: WorkspaceModalActionsContext,
): WorkspaceModalActions {
  const { state, showModal } = context;
  let timerInterval: number | undefined;
  let timerSeconds = 25 * 60;

  function stopTimer(): void {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = undefined;
  }

  function openSearch(): void {
    showModal(
      `<div class="search-box"><span>⌕</span><input id="search-input" placeholder="Search tasks, notes, and links…" autocomplete="off"><kbd>esc</kbd></div><div id="search-results" class="search-results"><div class="search-hint">Start typing to search your workspace</div></div>`,
    );
    const input = element<HTMLInputElement>("#search-input");
    input.focus();
    input.oninput = () => {
      const query = input.value.trim().toLowerCase();
      const results = element<HTMLDivElement>("#search-results");
      if (!query) {
        results.innerHTML =
          '<div class="search-hint">Start typing to search your workspace</div>';
        return;
      }
      const matches = [
        ...state.tasks
          .filter((item) => item.title.toLowerCase().includes(query))
          .map((item) => ({
            type: "Task",
            title: item.title,
            detail: `${formatShort(item.date)} · ${item.tag}`,
          })),
        ...state.notes
          .filter((item) =>
            `${item.title} ${item.body}`.toLowerCase().includes(query),
          )
          .map((item) => ({
            type: "Note",
            title: item.title,
            detail: item.body.slice(0, 70),
          })),
        ...state.links
          .filter((item) =>
            `${item.title} ${item.url}`.toLowerCase().includes(query),
          )
          .map((item) => ({
            type: "Link",
            title: item.title,
            detail: item.url,
          })),
      ];
      results.innerHTML = matches.length
        ? matches
            .map(
              (match) =>
                `<div class="search-result"><span>${match.type}</span><div><strong>${escapeHtml(match.title)}</strong><small>${escapeHtml(match.detail)}</small></div></div>`,
            )
            .join("")
        : '<div class="search-hint">No matches found</div>';
    };
  }

  function openFocus(taskId: number): void {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    stopTimer();
    timerSeconds = state.settings.focusDurationMinutes * 60;
    const initialMinutes = String(state.settings.focusDurationMinutes).padStart(
      2,
      "0",
    );
    showModal(
      `<div class="focus-modal"><div class="modal-kicker">FOCUS SESSION</div><p id="timer-display">${initialMinutes}:00</p><h2>${escapeHtml(task.title)}</h2><span>Everything else can wait.</span><div class="focus-controls"><button class="secondary-button" data-modal-close>Not now</button><button class="primary-button" id="timer-toggle">Start timer</button></div></div>`,
    );
    const toggle = element<HTMLButtonElement>("#timer-toggle");
    toggle.onclick = () => {
      if (timerInterval) {
        stopTimer();
        toggle.textContent = "Resume";
        return;
      }
      toggle.textContent = "Pause";
      timerInterval = window.setInterval(() => {
        timerSeconds -= 1;
        const minutes = Math.floor(timerSeconds / 60)
          .toString()
          .padStart(2, "0");
        const seconds = (timerSeconds % 60).toString().padStart(2, "0");
        const display = document.querySelector("#timer-display");
        if (display) display.textContent = `${minutes}:${seconds}`;
        if (timerSeconds <= 0) {
          stopTimer();
          toggle.textContent = "Complete";
        }
      }, 1000);
    };
  }

  return { openSearch, openFocus, stopTimer };
}
