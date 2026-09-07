import type { z } from "zod";

import {
  ActionManifestSchema,
  ActionSourceSchema,
  type ActionManifest,
  type ActionManifestInput,
  type ActionSource,
} from "../contracts/actions";

export interface ActionContext {
  source: ActionSource;
  signal?: AbortSignal;
}

export interface ActionDefinition<TInput, TOutput> {
  manifest: ActionManifestInput;
  input: z.ZodType<TInput>;
  handler: (
    input: TInput,
    context: ActionContext,
  ) => Promise<TOutput> | TOutput;
}

export class ActionRegistry {
  readonly #actions = new Map<string, ActionDefinition<unknown, unknown>>();

  register<TInput, TOutput>(
    definition: ActionDefinition<TInput, TOutput>,
  ): void {
    const manifest = ActionManifestSchema.parse(definition.manifest);
    if (this.#actions.has(manifest.id)) {
      throw new Error(`Action already registered: ${manifest.id}`);
    }
    this.#actions.set(manifest.id, {
      ...definition,
      manifest,
    } as ActionDefinition<unknown, unknown>);
  }

  get(actionId: string): ActionDefinition<unknown, unknown> | undefined {
    return this.#actions.get(actionId);
  }

  list(): readonly ActionManifest[] {
    return [...this.#actions.values()].map(({ manifest }) =>
      ActionManifestSchema.parse(manifest),
    );
  }

  async invoke<TOutput>(
    actionId: string,
    input: unknown,
    context: ActionContext,
  ): Promise<TOutput> {
    const action = this.#actions.get(actionId);
    if (!action) throw new Error(`Unknown action: ${actionId}`);
    const source = ActionSourceSchema.parse(context.source);
    const parsedInput = action.input.parse(input);
    return (await action.handler(parsedInput, {
      ...context,
      source,
    })) as TOutput;
  }
}
