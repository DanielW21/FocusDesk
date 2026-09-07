import { describe, expect, it } from "vitest";
import type { NativeInvoke } from "../../platform/native-bridge";
import { createWaterlooWorksEvaluatorConfigClient } from "./evaluator-config-client";

const incompleteStatus = {
  apiKeyConfigured: false,
  complete: false,
  files: {
    "profile.json": false,
    "candidate-context.md": false,
    "category-guidance.md": false,
    "instructions.md": false,
    "schema.json": false,
  },
};

describe("WaterlooWorks evaluator configuration client", () => {
  it("uses the separate native configuration actions and does not expose a saved key", async () => {
    const calls: Array<{ action: string; payload: unknown }> = [];
    const invoke: NativeInvoke = async <TResult>(
      action: string,
      payload?: unknown,
    ) => {
      calls.push({ action, payload });
      return incompleteStatus as TResult;
    };
    const client = createWaterlooWorksEvaluatorConfigClient(invoke);

    await expect(client.status()).resolves.toEqual(incompleteStatus);
    await expect(client.save({ apiKey: "test-secret" })).resolves.toEqual(
      incompleteStatus,
    );
    expect(calls).toEqual([
      { action: "waterlooworks.config.status", payload: {} },
      {
        action: "waterlooworks.config.save",
        payload: { apiKey: "test-secret" },
      },
    ]);
  });

  it("rejects non-HTTPS evaluator endpoints before invoking native code", async () => {
    const invoke: NativeInvoke = <TResult>() =>
      Promise.reject(
        new Error("Native code must not be called"),
      ) as Promise<TResult>;
    const client = createWaterlooWorksEvaluatorConfigClient(invoke);
    await expect(
      client.save({ endpoint: "http://example.test/evaluator" }),
    ).rejects.toThrow("HTTPS");
  });
});
