import { z } from "zod";
import { invokeNative, type NativeInvoke } from "../../platform/native-bridge";

export const evaluatorConfigFileNames = [
  "profile.json",
  "candidate-context.md",
  "category-guidance.md",
  "instructions.md",
  "schema.json",
] as const;

const EvaluatorConfigFileNameSchema = z.enum(evaluatorConfigFileNames);
// The macOS bridge may serialize NSNumber booleans as 0/1. Normalize that
// transport detail at the trust boundary, while rejecting other numbers.
const BridgeBooleanSchema = z.preprocess(
  (value) => (value === 0 ? false : value === 1 ? true : value),
  z.boolean(),
);
const EvaluatorConfigStatusSchema = z.object({
  apiKeyConfigured: BridgeBooleanSchema,
  complete: BridgeBooleanSchema,
  files: z.record(EvaluatorConfigFileNameSchema, BridgeBooleanSchema),
});

const EvaluatorConfigUpdateSchema = z
  .object({
    apiKey: z.string().min(1).max(4096).optional(),
    endpoint: z.string().url().max(2048).optional(),
    model: z.string().min(1).max(128).optional(),
    files: z
      .record(
        EvaluatorConfigFileNameSchema,
        z
          .string()
          .min(1)
          .max(1024 * 1024),
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.apiKey !== undefined ||
      value.endpoint !== undefined ||
      value.model !== undefined ||
      value.files !== undefined,
    "Provide a key, an endpoint, a model, or at least one configuration file.",
  );

export type WaterlooWorksEvaluatorStatus = z.infer<
  typeof EvaluatorConfigStatusSchema
>;
export type WaterlooWorksEvaluatorConfigUpdate = z.infer<
  typeof EvaluatorConfigUpdateSchema
>;

export function createWaterlooWorksEvaluatorConfigClient(
  invoke: NativeInvoke = invokeNative,
) {
  return {
    async status(): Promise<WaterlooWorksEvaluatorStatus> {
      return EvaluatorConfigStatusSchema.parse(
        await invoke<unknown>("waterlooworks.config.status", {}),
      );
    },
    async save(
      update: WaterlooWorksEvaluatorConfigUpdate,
    ): Promise<WaterlooWorksEvaluatorStatus> {
      const parsed = EvaluatorConfigUpdateSchema.parse(update);
      if (parsed.endpoint && new URL(parsed.endpoint).protocol !== "https:")
        throw new Error("The evaluator endpoint must use HTTPS.");
      return EvaluatorConfigStatusSchema.parse(
        await invoke<unknown>("waterlooworks.config.save", parsed),
      );
    },
  };
}
