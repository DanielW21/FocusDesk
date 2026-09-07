export interface FocusDeskPublicEnvironment {
  environment: string;
  debug: boolean;
  googleClientId?: string;
  googleScopes: string[];
  apiBaseUrl?: string;
}

export type PublicEnvironmentInput = Record<string, unknown>;

function readString(
  values: PublicEnvironmentInput,
  key: string,
): string | undefined {
  const value = values[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBoolean(
  values: PublicEnvironmentInput,
  key: string,
  fallback: boolean,
): boolean {
  const value = readString(values, key)?.toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function readList(
  values: PublicEnvironmentInput,
  key: string,
  fallback: string[],
): string[] {
  const value = readString(values, key);
  if (!value) return [...fallback];
  const entries = value.split(/[\s,]+/).filter(Boolean);
  return entries.length ? entries : [...fallback];
}

export function parsePublicEnvironment(
  values: PublicEnvironmentInput,
): FocusDeskPublicEnvironment {
  return {
    environment: readString(values, "VITE_FOCUSDESK_ENV") ?? "local",
    debug: readBoolean(values, "VITE_FOCUSDESK_DEBUG", false),
    googleClientId: readString(values, "VITE_FOCUSDESK_GOOGLE_CLIENT_ID"),
    googleScopes: readList(values, "VITE_FOCUSDESK_GOOGLE_SCOPES", [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]),
    apiBaseUrl: readString(values, "VITE_FOCUSDESK_API_BASE_URL"),
  };
}

const viteEnvironment =
  (import.meta as ImportMeta & { env?: PublicEnvironmentInput }).env ?? {};

/**
 * Renderer-safe configuration only. Secrets and user tokens must be handled
 * by the native layer and macOS Keychain instead of being exposed here.
 */
export const publicEnvironment = Object.freeze(
  parsePublicEnvironment(viteEnvironment),
);
