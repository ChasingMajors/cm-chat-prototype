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

const failed = results.filter(result => result.checks && result.checks.some(check => !check.ok && check.blocking !== false));
const warnings = results.filter(result => result.checks && result.checks.some(check => !check.ok && check.blocking === false));
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

if (warnings.length) {
  console.warn(`Sentinel command center test passed with ${warnings.length} advisory warning(s).`);
} else {
  console.log("Sentinel command center test passed.");
}

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

  // Deterministic read-only transport fixtures. No imports or publishes run.
  await page.route("https://script.google.com/macros/s/**", async route => {
    const body = JSON.parse(route.request().postData() || "{}");
    const data = body.action === "health" ? {ok:true,service:"cm_command_center_operator"}
      : body.action === "sourceWatch" ? {ok:true,items:[],fetched_count:1,summary:{covered:1}}
      : {ok:true,items:[{status:"known_issue",title:"Audit locked print-run source",sport:"baseball",source_url:"https://slabsquatch.substack.com/p/audit",blocked_reason:"Source access blocked."}],fetched_count:2,summary:{known_issue:1,covered:1}};
    await route.fulfill({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(data)});
  });
  try {
    await page.goto(COMMAND_CENTER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    await page.locator("#yesBtn").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#yesBtn").click();
    await page.getByText("Agent Cycle discovery complete.", {exact: true}).waitFor({timeout: 120000});
    const cycleText = await page.locator("body").innerText();
    result.checks.push(assertIncludes(cycleText, "print-run source article(s)", "Current Agent Cycle renders discovery counts"));
    await page.locator("#showPrvBtn").click();
    await page.getByText("PRINT RUN SOURCE FOUND - ACCESS BLOCKED", {exact: true}).first().waitFor();
    result.checks.push(assertIncludes(await page.locator("body").innerText(), "Audit locked print-run source", "Blocked print-run discoveries remain visible"));

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
      blocking: false,
      ok: overflow.scrollWidth <= overflow.clientWidth + 8,
      expected: `scrollWidth ${overflow.scrollWidth} <= clientWidth ${overflow.clientWidth} + 8`
    });

    result.checks.push({
      label: "No browser console errors",
      blocking: false,
      ok: consoleErrors.length === 0,
      expected: consoleErrors.slice(0, 5).join(" | ")
    });
    result.checks.push({
      label: "No uncaught page errors",
      ok: pageErrors.length === 0,
      expected: pageErrors.slice(0, 5).join(" | ")
    });

    result.screenshot = await saveScreenshot(page, slug(viewport.name));
    result.ok = result.checks.every(check => check.ok || check.blocking === false);
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
    result.checks.push({
      label: "Test completed without exception",
      ok: false,
      expected: result.error
    });
    result.ok = false;
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
    const blockingFailure = (result.checks || []).some(check => !check.ok && check.blocking !== false);
    const advisoryWarning = !blockingFailure && (result.checks || []).some(check => !check.ok && check.blocking === false);
    lines.push(`| ${escapeMarkdown(result.name)} | ${blockingFailure ? "FAIL" : advisoryWarning ? "PASS WITH WARNINGS" : "PASS"} | ${result.screenshot || ""} |`);
    (result.checks || []).forEach(check => {
      lines.push(`| ↳ ${escapeMarkdown(check.label)} | ${check.ok ? "PASS" : check.blocking === false ? "WARN" : "FAIL"} | ${escapeMarkdown(check.expected || "")} |`);
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
