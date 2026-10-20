import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
await fs.mkdir("design/validation",{recursive:true});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(
  "http://127.0.0.1:1420/?root=" +
    encodeURIComponent(process.cwd() + "/tests/fixtures/harbor"),
);
await page.getByText("harbor", { exact: true }).first().waitFor();
await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Appearance').selectOption('dark');await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByText("backend", { exact: true }).click();
await page.getByText("main.py", { exact: true }).first().click();
await page.locator(".cm-content").waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: "design/validation/islet-dark.png" });
await page
  .getByRole("button", { name: "Find in Files", exact: true })
  .first()
  .click();
await page.getByLabel("Search in folder").waitFor();
await page.getByLabel("Search text", { exact: true }).fill("Workspace");
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.waitForFunction(
  () => document.querySelectorAll(".search-result").length > 0,
);
console.log("Search matches", await page.locator(".search-result").count());
await page.screenshot({ path: "design/validation/islet-find.png" });
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.getByLabel("Appearance").selectOption("light");
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.screenshot({ path: "design/validation/islet-light.png" });
await page.getByText("README.md", { exact: true }).first().click();
await page.locator(".markdown h1").waitFor();
console.log(
  "Markdown heading",
  await page.locator(".markdown h1").textContent(),
);
await page.screenshot({ path: "design/validation/islet-markdown.png" });
console.log("Page errors", errors);
await browser.close();
if (errors.length) process.exitCode = 1;
