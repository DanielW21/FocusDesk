export type NativeAction = string;

export type NativeInvoke = <TResult>(
  action: NativeAction,
  payload?: unknown,
) => Promise<TResult>;

export interface FocusDeskNativeBridge {
  invoke: NativeInvoke;
  openLink(value: string): void;
}

declare global {
  interface Window {
    focusDesk?: FocusDeskNativeBridge;
  }
}

export class NativeBridgeUnavailableError extends Error {
  constructor() {
    super("The FocusDesk native bridge is unavailable");
    this.name = "NativeBridgeUnavailableError";
  }
}

export function isNativeBridgeAvailable(): boolean {
  return typeof window.focusDesk?.invoke === "function";
}

export async function invokeNative<TResult>(
  action: NativeAction,
  payload: unknown = {},
): Promise<TResult> {
  if (!window.focusDesk?.invoke) throw new NativeBridgeUnavailableError();
  return window.focusDesk.invoke<TResult>(action, payload);
}

export function openNativeLink(value: string): void {
  if (window.focusDesk?.openLink) {
    window.focusDesk.openLink(value);
    return;
  }

  void invokeNative("system.openLink", { value });
}
