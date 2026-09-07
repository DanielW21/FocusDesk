import { Page } from "puppeteer-core";
import { evaluateWebpageString } from "src/utils/scraping/parsing/evaluateWithRequestDomParser/evaluateWithRequestDomParser";
import { sanitizeMap } from "src/utils/scraping/parsing/sanitizeMap";

export const scrapeModalPanels = async (
  page: Page,
  webpage: string,
): Promise<
  [
    Record<string, string>,
    Record<string, string>,
    Record<string, string>,
    Record<string, string>,
  ]
> => {
  const rawPanels = await evaluateWebpageString(page, webpage)((document) => {
    return [...document.querySelectorAll(".panel")].map((panel) => {
      const out: Record<string, string> = {};
      const rows = panel.querySelectorAll(".tag__key-value-list");
      for (const row of rows) {
        const key = row.querySelector("span")?.textContent;
        if (!key) continue;
        out[key] = [...row.querySelectorAll("span ~ *")]
          .map((element) => element.innerHTML)
          .join(" ");
      }
      const panelText = panel.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (/^application qualifiers\b/i.test(panelText)) {
        out["Application Qualifiers"] = panelText
          .replace(/^application qualifiers\s*/i, "")
          .trim();
      }
      return out;
    });
  });
  return classifyModalPanels(rawPanels.map(sanitizeMap));
};

const mergePanels = (
  panels: readonly Record<string, string>[],
): Record<string, string> => Object.assign({}, ...panels);

/**
 * WaterlooWorks conditionally inserts an Application Qualifiers panel. Select
 * panels by their normalized field names instead of relying on their position.
 */
export const classifyModalPanels = (
  panels: readonly Record<string, string>[],
): [
  Record<string, string>,
  Record<string, string>,
  Record<string, string>,
  Record<string, string>,
] => {
  const jobInformation = panels.find((panel) => "job title" in panel) ?? {};
  const companyInformation =
    panels.find((panel) => "organization" in panel) ?? {};
  const qualifiers = panels.filter((panel) =>
    Object.keys(panel).some((key) =>
      /qualifier|restrict|eligible|student program/i.test(key),
    ),
  );
  const applicationDelivery = panels.filter(
    (panel) =>
      panel !== jobInformation &&
      panel !== companyInformation &&
      !qualifiers.includes(panel),
  );
  return [
    jobInformation,
    mergePanels(applicationDelivery),
    companyInformation,
    mergePanels(qualifiers),
  ];
};
