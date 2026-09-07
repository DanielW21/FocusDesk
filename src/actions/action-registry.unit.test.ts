import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ActionRegistry } from "./action-registry";

describe("ActionRegistry", () => {
  it("validates input and invokes a registered action", async () => {
    const registry = new ActionRegistry();
    registry.register({
      manifest: { id: "tasks.echo", title: "Echo", mutatesData: false },
      input: z.object({ value: z.string() }),
      handler: ({ value }, context) => `${context.source}:${value}`,
    });

    await expect(
      registry.invoke<string>("tasks.echo", { value: "ok" }, { source: "ui" }),
    ).resolves.toBe("ui:ok");
    await expect(
      registry.invoke("tasks.echo", { value: 4 }, { source: "ui" }),
    ).rejects.toThrow();
  });

  it("rejects duplicate and unknown actions", async () => {
    const registry = new ActionRegistry();
    const definition = {
      manifest: { id: "tasks.noop", title: "No-op" },
      input: z.object({}),
      handler: () => undefined,
    };
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow(/already registered/);
    await expect(
      registry.invoke("tasks.missing", {}, { source: "ui" }),
    ).rejects.toThrow(/Unknown action/);
  });
});
