import {
  evaluatorConfigFileNames,
  type WaterlooWorksEvaluatorConfigUpdate,
  type WaterlooWorksEvaluatorStatus,
} from "./evaluator-config-client";

interface EvaluatorConfigClient {
  status: () => Promise<WaterlooWorksEvaluatorStatus>;
  save: (
    update: WaterlooWorksEvaluatorConfigUpdate,
  ) => Promise<WaterlooWorksEvaluatorStatus>;
}

export interface WaterlooWorksSettingsActionsContext {
  client: EvaluatorConfigClient;
  render: () => void;
  isNativeBridgeAvailable: () => boolean;
  isSettingsView: () => boolean;
}

export interface WaterlooWorksEvaluatorUiState {
  status: WaterlooWorksEvaluatorStatus | undefined;
  message: string;
  saving: boolean;
}

export interface WaterlooWorksSettingsActions {
  getState: () => WaterlooWorksEvaluatorUiState;
  refreshStatus: () => Promise<void>;
  save: () => Promise<void>;
}

export function createWaterlooWorksSettingsActions(
  context: WaterlooWorksSettingsActionsContext,
): WaterlooWorksSettingsActions {
  const { client, render, isNativeBridgeAvailable, isSettingsView } = context;
  const state: WaterlooWorksEvaluatorUiState = {
    status: undefined,
    message: "",
    saving: false,
  };

  async function refreshStatus(): Promise<void> {
    if (!isNativeBridgeAvailable()) return;
    try {
      state.status = await client.status();
      state.message = "";
    } catch (error: unknown) {
      state.message =
        error instanceof Error
          ? `Evaluator setup could not be checked. ${error.message}`
          : "Evaluator setup could not be checked.";
    }
    if (isSettingsView()) render();
  }

  async function save(): Promise<void> {
    if (state.saving) return;
    const apiKey = document.querySelector<HTMLInputElement>(
      "#waterlooworks-evaluator-api-key",
    );
    const endpoint = document.querySelector<HTMLInputElement>(
      "#waterlooworks-evaluator-endpoint",
    );
    const model = document.querySelector<HTMLInputElement>(
      "#waterlooworks-evaluator-model",
    );
    const selectedFiles = document.querySelector<HTMLInputElement>(
      "#waterlooworks-evaluator-files",
    );
    const button = document.querySelector<HTMLButtonElement>(
      '[data-action="waterlooworks-save-evaluator"]',
    );
    if (!apiKey || !endpoint || !model || !selectedFiles) return;

    const update: WaterlooWorksEvaluatorConfigUpdate = {};
    if (apiKey.value.trim()) update.apiKey = apiKey.value.trim();
    if (endpoint.value.trim()) update.endpoint = endpoint.value.trim();
    if (model.value.trim()) update.model = model.value.trim();

    const files: Partial<
      Record<(typeof evaluatorConfigFileNames)[number], string>
    > = {};
    for (const file of Array.from(selectedFiles.files ?? [])) {
      const name =
        file.name === "profile.example.json" ? "profile.json" : file.name;
      if (
        !evaluatorConfigFileNames.includes(
          name as (typeof evaluatorConfigFileNames)[number],
        )
      ) {
        state.message = `Unsupported evaluator file: ${file.name}.`;
        render();
        return;
      }
      if (file.size > 1024 * 1024) {
        state.message = `${file.name} is larger than 1 MB.`;
        render();
        return;
      }
      files[name as (typeof evaluatorConfigFileNames)[number]] =
        await file.text();
    }
    if (Object.keys(files).length > 0)
      update.files = files as Record<
        (typeof evaluatorConfigFileNames)[number],
        string
      >;

    state.saving = true;
    if (button) button.disabled = true;
    try {
      state.status = await client.save(update);
      state.message = state.status.complete
        ? "Evaluator setup saved and ready to use."
        : "Saved. Add the API key and all five evaluator files to enable grading.";
    } catch (error: unknown) {
      state.message =
        error instanceof Error
          ? `Evaluator setup was not saved. ${error.message}`
          : "Evaluator setup was not saved.";
    } finally {
      state.saving = false;
      render();
    }
  }

  return { getState: () => state, refreshStatus, save };
}
