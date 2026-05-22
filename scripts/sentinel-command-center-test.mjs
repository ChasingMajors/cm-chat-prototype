import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const COMMAND_CENTER_URL = cleanEnv("COMMAND_CENTER_URL") || "https://chasingmajors.github.io/cm-chat-prototype/command-center/";
const OUT_DIR = cleanEnv("OUT_DIR") || "sentinel-test-results";
const HEADLESS = cleanEnv("HEADLESS") !== "false";
const CHROME_EXECUTABLE = cleanEnv("CHROME_EXECUTABLE");

await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch(Object.assign(
  { headless: HEADLESS },
  CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}
));

const results = [];

try {
  results.push(await testViewport({ name: "Desktop cockpit", width: 1440, height: 1100 }));
  results.push(await testViewport({ name: "Mobile cockpit", width: 390, height: 844 }));
} finally {
  await browser.close();
}

await writeReport(results);

const failed = results.filter(result => !result.ok);
if (failed.length) {
  failed.forEach(result => {
    console.error(`\nFAILED: ${result.name}`);
    console.error(`URL: ${result.url}`);
    if (result.error) console.error(`Error: ${result.error}`);
    (result.checks || []).filter(check => !check.ok).forEach(check => {
      console.error(`- ${check.label}`);
      if (check.expected) console.error(`  Expected: ${check.expected}`);
    });
    if (result.screenshot) console.error(`Screenshot: ${result.screenshot}`);
  });
  console.error(`Sentinel command center test failed: ${failed.length} issue(s).`);
  process.exit(1);
}

console.log("Sentinel command center test passed.");

async function testViewport(viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "light"
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const result = {
    name: viewport.name,
    url: COMMAND_CENTER_URL,
    viewport,
    ok: false,
    checks: []
  };

  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => {
    pageErrors.push(error && error.message ? error.message : String(error));
  });

  try {
    await page.goto(COMMAND_CENTER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    await page.getByText("Good morning, Admin.", { exact: false }).waitFor({ state: "visible", timeout: 30000 });

    const initialText = await page.locator("body").innerText({ timeout: 10000 });
    result.checks.push(assertIncludes(initialText, "CM Sentinel", "CM Sentinel brand visible"));
    result.checks.push(assertIncludes(initialText, "Agent Action Queue", "Agent Action Queue visible"));
    result.checks.push(assertIncludes(initialText, "Public Tool Excellence", "Public Tool Excellence visible"));
    result.checks.push(assertIncludes(initialText, "Run Agent Cycle", "Run Agent Cycle visible"));

    await clickAndWait(page, "#publicToolAuditBtn", /Public Tool Audit complete|Public data layer score|feed issue/i, 45000);
    const publicAuditText = await page.locator("body").innerText({ timeout: 10000 });
    result.checks.push(assertIncludes(publicAuditText, "Public Tool Audit complete", "Public Tool Audit completes"));
    result.checks.push(assertAnyIncludes(publicAuditText, ["Checklist Vault", "Print Run Vault", "Release Schedule"], "Public tool cards render"));

    await clickAndWait(page, "#refreshBtn", /Auditing|Open items|Admin Brief|Data Health/i, 45000);
    const healthText = await page.locator("body").innerText({ timeout: 10000 });
    result.checks.push(assertNotIncludes(healthText, "Command Center runtime error", "No runtime error shown"));
    result.checks.push(assertNotIncludes(healthText, "Audit could not complete", "Health audit does not hard-fail"));

    await page.locator("#agentCycleBtn").click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const cycleText = await page.locator("body").innerText({ timeout: 10000 });
    result.checks.push(assertAnyIncludes(cycleText, [
      "Running daily Sentinel sweep",
      "Wait for active work",
      "Build approved PRV preview",
      "Verify PRV public JSON",
      "Admin decision required",
      "Operator Backend needed",
      "Daily Sentinel sweep complete"
    ], "Run Agent Cycle produces an operator response"));

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        bodyWidth: document.body ? document.body.scrollWidth : 0
      };
    });
    result.checks.push({
      label: "No major horizontal overflow",
      ok: overflow.scrollWidth <= overflow.clientWidth + 8,
      expected: `scrollWidth ${overflow.scrollWidth} <= clientWidth ${overflow.clientWidth} + 8`
    });

    result.checks.push({
      label: "No browser console errors",
      ok: consoleErrors.length === 0,
      expected: consoleErrors.slice(0, 5).join(" | ")
    });
    result.checks.push({
      label: "No uncaught page errors",
      ok: pageErrors.length === 0,
      expected: pageErrors.slice(0, 5).join(" | ")
    });

    result.screenshot = await saveScreenshot(page, slug(viewport.name));
    result.ok = result.checks.every(check => check.ok);
  } catch (err) {
    result.ok = false;
    result.error = err && err.message ? err.message : String(err);
    result.screenshot = await saveScreenshot(page, slug(viewport.name));
  } finally {
    await context.close();
  }

  return result;
}

async function clickAndWait(page, selector, pattern, timeoutMs) {
  await page.locator(selector).click({ timeout: 10000 });
  await page.waitForFunction(source => {
    const re = new RegExp(source, "i");
    return re.test(document.body.innerText || "");
  }, pattern.source, { timeout: timeoutMs });
  await page.waitForTimeout(500);
}

async function saveScreenshot(page, name) {
  const screenshotPath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function writeReport(results) {
  const jsonPath = path.join(OUT_DIR, "sentinel-command-center-test.json");
  const markdownPath = path.join(OUT_DIR, "sentinel-command-center-test.md");
  await fs.writeFile(jsonPath, JSON.stringify({
    command_center_url: COMMAND_CENTER_URL,
    generated_at: new Date().toISOString(),
    results
  }, null, 2));

  const lines = [
    "# Sentinel Command Center Test",
    "",
    `URL: ${COMMAND_CENTER_URL}`,
    "",
    "| Check | Result | Screenshot |",
    "| --- | --- | --- |"
  ];

  results.forEach(result => {
    lines.push(`| ${escapeMarkdown(result.name)} | ${result.ok ? "PASS" : "FAIL"} | ${result.screenshot || ""} |`);
    (result.checks || []).forEach(check => {
      lines.push(`| ↳ ${escapeMarkdown(check.label)} | ${check.ok ? "PASS" : "FAIL"} | ${escapeMarkdown(check.expected || "")} |`);
    });
  });

  await fs.writeFile(markdownPath, lines.join("\n"));
}

function assertIncludes(text, needle, label) {
  return {
    label,
    ok: normalizeText(text).includes(normalizeText(needle)),
    expected: needle
  };
}

function assertAnyIncludes(text, needles, label) {
  const normalized = normalizeText(text);
  return {
    label,
    ok: needles.some(needle => normalized.includes(normalizeText(needle))),
    expected: needles.join(" | ")
  };
}

function assertNotIncludes(text, needle, label) {
  return {
    label,
    ok: !normalizeText(text).includes(normalizeText(needle)),
    expected: `No "${needle}"`
  };
}

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function slug(value) {
  return String(value || "screenshot")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "screenshot";
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
