import { invokeNative, type NativeInvoke } from "../../platform/native-bridge";
import type { FocusDeskDatabaseDocument } from "../../app/app-database";

interface NativeWorkspaceResponse {
  document?: FocusDeskDatabaseDocument;
}

export interface NativeWorkspaceClient {
  load(): Promise<FocusDeskDatabaseDocument | undefined>;
  save(document: FocusDeskDatabaseDocument): Promise<void>;
}

export function createNativeWorkspaceClient(
  invoke: NativeInvoke = invokeNative,
): NativeWorkspaceClient {
  return {
    async load() {
      const response = await invoke<NativeWorkspaceResponse>(
        "focusdesk.workspace.load",
      );
      return response.document;
    },
    async save(document) {
      await invoke("focusdesk.workspace.save", { document });
    },
  };
}
