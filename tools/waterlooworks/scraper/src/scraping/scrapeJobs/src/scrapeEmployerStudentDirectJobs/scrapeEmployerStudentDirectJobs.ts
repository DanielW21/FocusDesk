import { IScrapedJob, ProgressReporter } from "@internwave/scrapers-api";
import { Page } from "puppeteer-core";
import { Links } from "src/constants/Links";
import { Strings } from "src/constants/Strings";
import { scrapeJobModals } from "src/scraping/scrapeJobs/src/scrapeJobModals/scrapeJobModals";
import { scrapeTable } from "src/scraping/scrapeJobs/src/scrapeTable/scrapeTable";
import { IJobRowResponse } from "src/scraping/scrapeJobs/src/scrapeTable/types/Response";
import { injectBanner } from "src/utils/scraping/render/injectBanner";

export const scrapeEmployerStudentDirectJobs = async (
  page: Page,
  progressReporter: ProgressReporter,
): Promise<IScrapedJob[]> => {
  await page.goto(Links.EMPLOYER_STUDENT_DIRECT_JOBS);
  await injectBanner(page, Strings.scraping.banner());
  const jobRows: IJobRowResponse[] = await scrapeTable(page, progressReporter);
  return scrapeJobModals(
    page,
    progressReporter,
    jobRows,
    Links.employerStudentDirectJob,
  );
};
