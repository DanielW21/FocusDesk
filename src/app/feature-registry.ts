import {
  FeatureManifestSchema,
  type FeatureDefinition,
} from "../contracts/features";
import type { WidgetRegistry } from "../widgets/widget-registry";

export class FeatureRegistry {
  readonly #features = new Map<string, FeatureDefinition>();

  constructor(private readonly widgets: WidgetRegistry) {}

  register(feature: FeatureDefinition): void {
    const manifest = FeatureManifestSchema.parse(feature.manifest);
    if (this.#features.has(manifest.id))
      throw new Error(`Feature already registered: ${manifest.id}`);

    for (const widget of feature.widgets) {
      if (widget.manifest.featureId !== manifest.id) {
        throw new Error(
          `Widget ${widget.manifest.id} belongs to ${widget.manifest.featureId}, not ${manifest.id}`,
        );
      }
      this.widgets.register(widget);
    }

    this.#features.set(manifest.id, feature);
  }

  get(featureId: string): FeatureDefinition | undefined {
    return this.#features.get(featureId);
  }

  list(): readonly FeatureDefinition[] {
    return [...this.#features.values()];
  }
}
