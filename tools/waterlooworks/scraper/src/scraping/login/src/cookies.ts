import fs from "fs";
import path from "path";
import { Page } from "puppeteer-core";

export const saveCookies = async (page: Page) => {
  const cookiesPath = getCookiesPath();
  if (!cookiesPath) {
    return;
  }
  const client = await page.createCDPSession();
  // This gets all cookies from all URLs, not just the current URL
  const cookies = (await client.send("Network.getAllCookies"))["cookies"];
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies), { mode: 0o600 });
  fs.chmodSync(cookiesPath, 0o600);
};
export const loadCookies = async (page: Page) => {
  try {
    const cookiesPath = getCookiesPath();
    if (!cookiesPath) {
      return;
    }
    if (!fs.existsSync(cookiesPath)) {
      return;
    }
    const buf = fs.readFileSync(cookiesPath);
    const cookies = JSON.parse(buf as unknown as string);
    for (const cookie of cookies) {
      await page.setCookie(cookie);
    }
  } catch (err) {
    console.warn("Could not restore WaterlooWorks cookies; interactive login required.");
  }
};

export const deleteCookies = () => {
  const cookiesPath = getCookiesPath();
  if (!cookiesPath) {
    return;
  }
  if (fs.existsSync(cookiesPath)) {
    fs.unlinkSync(cookiesPath);
  }
};

const getCookiesPath = () => {
  if (!process.env.WW_CONFIG_DIR) throw new Error("WaterlooWorks configuration directory is unavailable");
  return path.join(process.env.WW_CONFIG_DIR, "cookies");
};
