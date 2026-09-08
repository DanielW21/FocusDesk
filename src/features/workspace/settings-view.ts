import type { AppState } from "../../app/app-state";
import type { AppRegistries } from "../../app/bootstrap";
import { publicEnvironment } from "../../config/public-environment";
import { dimensionLabel, widgetStyleKey } from "./dashboard-view";
import type { GoogleCalendarSummary } from "./google-calendar-client";
import {
  evaluatorConfigFileNames,
  type WaterlooWorksEvaluatorStatus,
} from "../waterlooworks/evaluator-config-client";
import { escapeHtml } from "../../ui/formatters";

export interface SettingsViewContext {
  state: AppState;
  registries: AppRegistries;
  googleCalendarConnected: boolean;
  googleCalendarLastSyncAt: string;
  googleCalendarCalendars: GoogleCalendarSummary[];
  googleCalendarMessage: string;
  googleCalendarBusy: boolean;
  waterlooWorksEvaluatorStatus: WaterlooWorksEvaluatorStatus | undefined;
  waterlooWorksEvaluatorMessage: string;
  waterlooWorksEvaluatorSaving: boolean;
  nativeBridgeAvailable: boolean;
}

function googleCalendarColor(calendar: GoogleCalendarSummary): string {
  return /^#[0-9a-f]{6}$/i.test(calendar.backgroundColor ?? "")
    ? calendar.backgroundColor!
    : "#789080";
}

export function renderSettingsView(context: SettingsViewContext): string {
  const {
    state,
    registries,
    googleCalendarConnected,
    googleCalendarLastSyncAt,
    googleCalendarCalendars,
    googleCalendarMessage,
    googleCalendarBusy,
    waterlooWorksEvaluatorStatus,
    waterlooWorksEvaluatorMessage,
    waterlooWorksEvaluatorSaving,
    nativeBridgeAvailable,
  } = context;
  const widgetRows = registries.widgets
    .list()
    .map((definition) => {
      const meta = definition.manifest;
      const styleKey = widgetStyleKey(meta.id);
      const current = state.widgetLayout.instances.find(
        (item) => item.widgetId === meta.id,
      );
      const selectedDimension = current?.dimension ?? meta.defaultDimension;
      const dimensions = meta.supportedDimensions
        .map(
          (dimension) =>
            `<option value="${dimension}" ${dimension === selectedDimension ? "selected" : ""}>${dimensionLabel(dimension)}</option>`,
        )
        .join("");
      return `<div class="settings-tool-row"><div class="settings-tool-info"><span class="settings-tool-icon widget-${styleKey}">${meta.icon}</span><div><strong>${escapeHtml(meta.title)}</strong><small>${escapeHtml(meta.description)}</small></div></div><div class="settings-tool-controls"><label class="settings-dimension"><span>Size</span><select data-action="settings-widget-dimension" data-widget-id="${escapeHtml(meta.id)}" aria-label="${escapeHtml(meta.title)} size">${dimensions}</select></label><button class="settings-toggle ${current?.visible ? "active" : ""}" data-action="settings-toggle-widget" data-widget-id="${escapeHtml(meta.id)}" aria-pressed="${current?.visible ? "true" : "false"}">${current?.visible ? "Shown" : "Hidden"}</button></div></div>`;
    })
    .join("");
  const todoDays = [
    ...new Set([1, 3, 7, 14, 30, 60, 90, state.settings.taskManagerTodoDays]),
  ]
    .sort((a, b) => a - b)
    .map(
      (days) =>
        `<option value="${days}" ${state.settings.taskManagerTodoDays === days ? "selected" : ""}>${days} day${days === 1 ? "" : "s"}</option>`,
    )
    .join("");
  const googleCalendarStatus = !publicEnvironment.googleClientId
    ? "Client ID not configured"
    : googleCalendarConnected
      ? "Connected"
      : "Not connected";
  const googleCalendarRows = googleCalendarConnected
    ? googleCalendarCalendars.length
      ? googleCalendarCalendars
          .map((calendar) => {
            const checked = state.settings.googleCalendarIds.includes(
              calendar.id,
            );
            const eventCount = state.events.filter(
              (event) => event.googleCalendarId === calendar.id,
            ).length;
            return `<label class="google-calendar-row"><input type="checkbox" data-action="google-calendar-toggle" data-calendar-id="${escapeHtml(calendar.id)}" ${checked ? "checked" : ""} ${googleCalendarBusy ? "disabled" : ""}><span class="google-calendar-color" style="--google-calendar-color:${googleCalendarColor(calendar)}"></span><span class="google-calendar-copy"><strong>${escapeHtml(calendar.summary)}</strong><small>${calendar.primary ? "Primary calendar" : escapeHtml(calendar.accessRole ?? "Google Calendar")} · ${eventCount} synced event${eventCount === 1 ? "" : "s"}</small></span></label>`;
          })
          .join("")
      : '<p class="settings-empty">No calendars were returned by Google yet.</p>'
    : '<p class="settings-empty">Connect Google Calendar to choose which calendars appear in FocusDesk.</p>';
  const googleCalendarSyncLabel = googleCalendarLastSyncAt
    ? `Last sync ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(googleCalendarLastSyncAt))}`
    : "Not synced yet";
  const evaluatorFiles = waterlooWorksEvaluatorStatus?.files;
  const evaluatorReady = waterlooWorksEvaluatorStatus?.complete;
  const evaluatorStatus = !nativeBridgeAvailable
    ? "Available in FocusDesk for macOS"
    : evaluatorReady
      ? "Ready"
      : waterlooWorksEvaluatorStatus
        ? "Needs setup"
        : "Checking setup";
  const evaluatorFileSummary = evaluatorFiles
    ? evaluatorConfigFileNames.every((name) => evaluatorFiles[name])
      ? "Existing WaterlooWorks evaluator configuration imported automatically."
      : "Existing evaluator configuration not found."
    : "Checking existing WaterlooWorks evaluator configuration…";

  return `<div class="view-wrap settings-view">
    <div class="title-row"><div><p class="eyebrow">Make it yours</p><h1>Settings</h1><p class="date-line">Tune FocusDesk and each tool to fit the way you work.</p></div><button class="secondary-button" data-action="settings-reset">Reset settings</button></div>
    <div class="settings-layout">
      <section class="settings-section settings-section-wide"><div class="settings-section-heading"><div><span class="settings-section-icon">◌</span><div><h2>Appearance</h2><p>Set the overall feel of your workspace.</p></div></div><span class="settings-saved">Saved locally</span></div><div class="settings-control-grid">
        <label class="settings-field"><span>Theme</span><small>Choose how FocusDesk looks.</small><select data-setting="theme"><option value="light" ${state.settings.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${state.settings.theme === "dark" ? "selected" : ""}>Dark</option></select></label>
        <label class="settings-field"><span>Accent color</span><small>Used for actions and highlights.</small><select data-setting="accent"><option value="coral" ${state.settings.accent === "coral" ? "selected" : ""}>Coral</option><option value="sage" ${state.settings.accent === "sage" ? "selected" : ""}>Sage</option><option value="blue" ${state.settings.accent === "blue" ? "selected" : ""}>Blue</option><option value="gold" ${state.settings.accent === "gold" ? "selected" : ""}>Gold</option></select></label>
        <label class="settings-field"><span>Interface density</span><small>Adjust spacing across views and cards.</small><select data-setting="density"><option value="compact" ${state.settings.density === "compact" ? "selected" : ""}>Compact</option><option value="comfortable" ${state.settings.density === "comfortable" ? "selected" : ""}>Comfortable</option><option value="spacious" ${state.settings.density === "spacious" ? "selected" : ""}>Spacious</option></select></label>
      </div></section>
      <section class="settings-section"><div class="settings-section-heading"><div><span class="settings-section-icon">↯</span><div><h2>TaskManager</h2><p>Choose its starting view and progress layout.</p></div></div></div><div class="settings-field-stack">
        <label class="settings-field"><span>Initial view</span><small>Used when you open TaskManager.</small><select data-setting="taskManagerMode"><option value="list" ${state.settings.taskManagerMode === "list" ? "selected" : ""}>Open tasks</option><option value="fulllist" ${state.settings.taskManagerMode === "fulllist" ? "selected" : ""}>All tasks</option><option value="exams" ${state.settings.taskManagerMode === "exams" ? "selected" : ""}>Upcoming exams</option><option value="progress" ${state.settings.taskManagerMode === "progress" ? "selected" : ""}>Progress</option><option value="todo" ${state.settings.taskManagerMode === "todo" ? "selected" : ""}>Todo</option></select></label>
        <label class="settings-field"><span>Progress layout</span><small>Compact cards or the two-column task view.</small><select data-setting="taskManagerProgressView"><option value="compact" ${state.settings.taskManagerProgressView === "compact" ? "selected" : ""}>Compact</option><option value="detailed" ${state.settings.taskManagerProgressView === "detailed" ? "selected" : ""}>Detailed</option></select></label>
        <label class="settings-field"><span>Todo window</span><small>How far ahead the Todo view looks.</small><select data-setting="taskManagerTodoDays">${todoDays}</select></label>
      </div></section>
      <section class="settings-section"><div class="settings-section-heading"><div><span class="settings-section-icon">◎</span><div><h2>Focus timer</h2><p>Set the length of a focused work session.</p></div></div></div><div class="settings-field-stack">
        <label class="settings-field"><span>Session length</span><small>Used by the Focus widget and timer.</small><select data-setting="focusDurationMinutes"><option value="15" ${state.settings.focusDurationMinutes === 15 ? "selected" : ""}>15 minutes</option><option value="25" ${state.settings.focusDurationMinutes === 25 ? "selected" : ""}>25 minutes</option><option value="45" ${state.settings.focusDurationMinutes === 45 ? "selected" : ""}>45 minutes</option><option value="60" ${state.settings.focusDurationMinutes === 60 ? "selected" : ""}>60 minutes</option><option value="90" ${state.settings.focusDurationMinutes === 90 ? "selected" : ""}>90 minutes</option></select></label>
      </div></section>
      <section class="settings-section settings-section-wide"><div class="settings-section-heading"><div><span class="settings-section-icon">↗</span><div><h2>WaterlooWorks evaluator</h2><p>Set up local AI grading for your Co-op job reviews.</p></div></div><span class="settings-saved">${escapeHtml(evaluatorStatus)}</span></div><div class="waterlooworks-evaluator-copy"><p>Your key is stored privately by FocusDesk, never in the app bundle or Git.</p><small>${escapeHtml(evaluatorFileSummary)}</small></div><div class="settings-control-grid waterlooworks-evaluator-fields"><label class="settings-field"><span>DeepSeek API key</span><small>${waterlooWorksEvaluatorStatus?.apiKeyConfigured ? "A key is already saved. Leave blank to keep it." : "Required to run AI grading."}</small><input id="waterlooworks-evaluator-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${waterlooWorksEvaluatorStatus?.apiKeyConfigured ? "Saved securely" : "sk-…"}"></label><label class="settings-field"><span>Endpoint</span><small>Optional. Defaults to DeepSeek’s HTTPS endpoint.</small><input id="waterlooworks-evaluator-endpoint" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.deepseek.com/chat/completions"></label><label class="settings-field"><span>Model</span><small>Optional. Defaults to deepseek-v4-flash.</small><input id="waterlooworks-evaluator-model" type="text" autocomplete="off" spellcheck="false" placeholder="deepseek-v4-flash"></label></div><div class="waterlooworks-evaluator-import"><details><summary>Replace evaluator configuration files (advanced)</summary><label class="settings-field"><span>Configuration files</span><small>Only use this if you are setting up FocusDesk on a computer without the existing WaterlooWorks evaluator.</small><input id="waterlooworks-evaluator-files" type="file" multiple accept=".json,.md,application/json,text/markdown,text/plain"></label></details><button class="primary-button" data-action="waterlooworks-save-evaluator" ${waterlooWorksEvaluatorSaving || !nativeBridgeAvailable ? "disabled" : ""}>${waterlooWorksEvaluatorSaving ? "Saving…" : "Save evaluator setup"}</button></div>${waterlooWorksEvaluatorMessage ? `<p class="waterlooworks-evaluator-message" role="status">${escapeHtml(waterlooWorksEvaluatorMessage)}</p>` : ""}</section>
      <section class="settings-section settings-section-wide"><div class="settings-section-heading"><div><span class="settings-section-icon">▣</span><div><h2>Google Calendar</h2><p>Pull selected calendars into FocusDesk and push FocusDesk events back to Google.</p></div></div><span class="settings-saved">${escapeHtml(googleCalendarStatus)}</span></div><div class="google-calendar-toolbar"><div><strong>${escapeHtml(googleCalendarSyncLabel)}</strong><small>${escapeHtml(googleCalendarMessage || (googleCalendarConnected ? "Selected calendars sync incrementally and are safe to refresh." : "Your Google refresh token stays in macOS Keychain."))}</small></div><div class="settings-tool-controls"><button class="${googleCalendarConnected ? "secondary-button" : "primary-button"}" data-action="google-calendar-connect" ${googleCalendarBusy || !publicEnvironment.googleClientId ? "disabled" : ""}>${googleCalendarConnected ? "Reconnect" : "Connect Google"}</button>${googleCalendarConnected ? `<button class="secondary-button" data-action="google-calendar-sync" ${googleCalendarBusy ? "disabled" : ""}>↻ Sync now</button><button class="secondary-button" data-action="google-calendar-disconnect" ${googleCalendarBusy ? "disabled" : ""}>Disconnect</button>` : ""}</div></div><label class="google-calendar-auto-sync"><input type="checkbox" data-action="google-calendar-auto-sync" ${state.settings.googleCalendarAutoSync ? "checked" : ""}><span><strong>Sync on app startup</strong><small>Refresh selected calendars when FocusDesk opens.</small></span></label><div class="google-calendar-list-heading"><strong>Calendars</strong><small>Checked calendars are pulled into the Calendar view.</small></div><div class="google-calendar-list">${googleCalendarRows}</div></section>
      <section class="settings-section"><div class="settings-section-heading"><div><span class="settings-section-icon">✦</span><div><h2>Dashboard tools</h2><p>Show, hide, and resize every widget from one place.</p></div></div></div><div class="settings-tool-list">${widgetRows}</div><button class="secondary-button settings-restore" data-action="settings-restore-dashboard">Restore default dashboard</button></section>
    </div>
  </div>`;
}
