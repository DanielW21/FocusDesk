import type { WidgetDefinition, WidgetDimension } from "../contracts/widgets";

export class WidgetRegistry {
  readonly #definitions = new Map<string, WidgetDefinition>();

  register(definition: WidgetDefinition): void {
    const { id } = definition.manifest;
    if (this.#definitions.has(id))
      throw new Error(`Widget already registered: ${id}`);
    this.#definitions.set(id, definition);
  }

  get(widgetId: string): WidgetDefinition | undefined {
    return this.#definitions.get(widgetId);
  }

  require(widgetId: string): WidgetDefinition {
    const definition = this.get(widgetId);
    if (!definition) throw new Error(`Unknown widget: ${widgetId}`);
    return definition;
  }

  list(): readonly WidgetDefinition[] {
    return [...this.#definitions.values()];
  }

  nextDimension(
    widgetId: string,
    currentDimension: WidgetDimension,
  ): WidgetDimension {
    const dimensions = this.require(widgetId).manifest.supportedDimensions;
    const currentIndex = dimensions.indexOf(currentDimension);
    return (
      dimensions[(currentIndex + 1) % dimensions.length] ??
      dimensions[0] ??
      "1x2"
    );
  }
}
