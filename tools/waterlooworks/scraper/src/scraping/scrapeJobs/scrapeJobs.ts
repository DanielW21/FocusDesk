import { ProgressReporter } from "@internwave/scrapers-api";
import { Page } from "puppeteer-core";
import { JobBoard } from "src/constants/JobBoards";
import { scrapeCoopJobs } from "src/scraping/scrapeJobs/src/scrapeCoopJobs/scrapeCoopJobs";
import { scrapeEmployerStudentDirectJobs } from "src/scraping/scrapeJobs/src/scrapeEmployerStudentDirectJobs/scrapeEmployerStudentDirectJobs";
import { scrapeGraduateJobs } from "src/scraping/scrapeJobs/src/scrapeGraduateJobs/scrapeGraduateJobs";

export const scrapeJobs = async (
  page: Page,
  progressReporter: ProgressReporter,
  type: JobBoard,
) => {
  switch (type) {
    case JobBoard.COOP:
      return scrapeCoopJobs(page, progressReporter);
    case JobBoard.EMPLOYER_STUDENT_DIRECT:
      return scrapeEmployerStudentDirectJobs(page, progressReporter);
    case JobBoard.GRADUATING_AND_FULL_TIME:
      return scrapeGraduateJobs(page, progressReporter);
    default:
      throw new Error(`Unsupported job board: ${String(type)}`);
  }
};
