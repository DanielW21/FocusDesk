import {
  WidgetManifestSchema,
  WidgetSettingsSchema,
  type WidgetCapability,
  type WidgetDimension,
  type WidgetDefinition,
  type WidgetSettings,
  type WidgetView,
} from "../contracts/widgets";

interface WidgetDefinitionInput {
  id: string;
  featureId: string;
  title: string;
  description: string;
  icon: string;
  defaultDimension: WidgetDimension;
  defaultSettings?: WidgetSettings;
  capabilities?: readonly WidgetCapability[];
  views: Partial<Record<WidgetDimension, WidgetView>>;
}

export function defineWidget(input: WidgetDefinitionInput): WidgetDefinition {
  const supportedDimensions = Object.keys(input.views).filter(
    (dimension) => input.views[dimension as WidgetDimension] !== undefined,
  ) as WidgetDimension[];
  if (!supportedDimensions.includes(input.defaultDimension)) {
    throw new Error(
      `Widget ${input.id} must implement its default dimension (${input.defaultDimension})`,
    );
  }

  const manifest = WidgetManifestSchema.parse({
    id: input.id,
    featureId: input.featureId,
    title: input.title,
    description: input.description,
    icon: input.icon,
    defaultDimension: input.defaultDimension,
    supportedDimensions,
    capabilities: input.capabilities ?? ["read-data"],
  });

  return {
    manifest,
    defaultSettings: WidgetSettingsSchema.parse(input.defaultSettings ?? {}),
    views: { ...input.views },
  };
}
