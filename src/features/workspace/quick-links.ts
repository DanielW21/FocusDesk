import type { QuickLink } from "./model";

export const DEFAULT_QUICK_LINK_COLOR = "#778e80";

export function quickLinkColor(link: Pick<QuickLink, "color">): string {
  const color = link.color?.trim();
  return color && /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : DEFAULT_QUICK_LINK_COLOR;
}

export function quickLinkType(url: string): "URL" | "FILE" | "APP" {
  if (/^(?:https?|ftp):\/\//i.test(url)) return "URL";
  if (/\.app(?:\/|$)/i.test(url) || /^app:\/\//i.test(url)) return "APP";
  return "FILE";
}

function escapeHtml(value = ""): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

export function quickLinkInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1)
    return words
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase();
  return title.trim().slice(0, 2).toUpperCase() || "↗";
}

export function quickLinkHoverText(link: QuickLink): string {
  return link.description?.trim() || link.title;
}

export function quickLinkAccessibleLabel(link: QuickLink): string {
  const description = link.description?.trim();
  return description ? `${link.title}: ${description}` : link.title;
}

function isImageAsset(value: string): boolean {
  return (
    /^(?:https?:\/\/|data:image\/|file:\/\/|\/|\.\.?\/)/i.test(value) ||
    /\.(?:avif|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(value)
  );
}

export function quickLinkAssetSource(value: string): string {
  if (/^\//.test(value))
    return `file://${encodeURI(value).replace(/#/g, "%23")}`;
  return value;
}

export function renderQuickLinkAsset(
  link: QuickLink,
  className: string,
): string {
  const asset = link.asset?.trim();
  const color = quickLinkColor(link);
  const fallback = `<span class="quick-link-fallback">${escapeHtml(quickLinkInitials(link.title))}</span>`;
  if (!asset || !isImageAsset(asset)) {
    return `<span class="${className} quick-link-asset" style="--quick-link-color:${color}" aria-hidden="true">${asset ? `<span class="quick-link-asset-text">${escapeHtml(asset.slice(0, 4))}</span>` : fallback}</span>`;
  }
  return `<span class="${className} quick-link-asset" style="--quick-link-color:${color}" aria-hidden="true"><img class="quick-link-asset-image" data-link-asset src="${escapeHtml(quickLinkAssetSource(asset))}" alt="">${fallback}</span>`;
}
