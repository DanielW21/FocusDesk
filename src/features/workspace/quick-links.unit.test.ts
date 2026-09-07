import { describe, expect, it } from "vitest";

import {
  quickLinkAccessibleLabel,
  quickLinkInitials,
  quickLinkType,
  renderQuickLinkAsset,
} from "./quick-links";

describe("quick link presentation", () => {
  it("creates useful initials for icon fallbacks", () => {
    expect(quickLinkInitials("Google Drive")).toBe("GD");
    expect(quickLinkInitials("WhatsApp")).toBe("WH");
  });

  it("renders an image asset while retaining a fallback", () => {
    const link = {
      id: 1,
      title: "Google Drive",
      url: "https://drive.google.com",
      description: "Course files",
      asset: "/Users/danielwu/Assets/drive icon.png",
    };
    const markup = renderQuickLinkAsset(link, "quick-link-icon-asset");

    expect(markup).toContain("file:///Users/danielwu/Assets/drive%20icon.png");
    expect(markup).toContain("GD");
    expect(quickLinkAccessibleLabel(link)).toBe("Google Drive: Course files");
  });

  it("classifies link destinations for compact cards", () => {
    expect(quickLinkType("https://example.com")).toBe("URL");
    expect(quickLinkType("/Users/danielwu/Documents/notes.pdf")).toBe("FILE");
    expect(quickLinkType("/Applications/FocusDesk.app")).toBe("APP");
  });
});
