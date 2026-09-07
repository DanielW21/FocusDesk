import type { WidgetDimension } from "../contracts/widgets";

export function dimensionParts(dimension: WidgetDimension): {
  columns: number;
  rows: number;
} {
  const [columns, rows] = dimension.split("x").map(Number);
  return {
    columns: columns || 1,
    rows: rows || 1,
  };
}

/**
 * Widget rows follow the declared dimension so every `Nx2` card gets two
 * visual grid rows, including compact dashboard cards.
 */
export function visualRows(dimension: WidgetDimension): number {
  return dimensionParts(dimension).rows;
}

export function visualHeight(dimension: WidgetDimension): number {
  const rows = visualRows(dimension);
  return rows * 120 + Math.max(0, rows - 1) * 14;
}
