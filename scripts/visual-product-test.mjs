import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const APP_BASE = cleanEnv("CM_APP_BASE") || "https://app.chasingmajors.com";
const CHATBOT_BASE = cleanEnv("CM_CHATBOT_BASE") || `${trimTrailingSlash(APP_BASE)}/ChatBot`;
const CHECKLIST_BASE = cleanEnv("CM_CHECKLIST_BASE") || APP_BASE;
const PRODUCT_NAME = cleanEnv("PRODUCT_NAME");
const SPORT = cleanEnv("SPORT");
const CODE = cleanEnv("PRODUCT_CODE");
const OUT_DIR = cleanEnv("OUT_DIR") || "visual-test-results";
const HEADLESS = cleanEnv("HEADLESS") !== "false";

if (!PRODUCT_NAME) {
  throw new Error("Missing PRODUCT_NAME.");
}

const productYear = (PRODUCT_NAME.match(/\b(?:19|20)\d{2}(?:-\d{2})?\b/) || [""])[0];
const shortQuery = buildShortProductQuery(PRODUCT_NAME);
const ambiguousQuery = stripYear(PRODUCT_NAME);
const chatbotQueries = unique([
  { label: "Exact product", query: PRODUCT_NAME, kind: "exact" },
  { label: "Short product", query: shortQuery, kind: "exact" },
  { label: "Checklist intent", query: `Show me ${PRODUCT_NAME} checklist`, kind: "checklist" },
  { label: "Details intent", query: `${PRODUCT_NAME} details`, kind: "exact" },
  { label: "Ambiguity", query: ambiguousQuery, kind: "ambiguous" }
].filter(item => item.query));

const checklistChecks = [
  {
    label: "Checklist Vault - All Sports",
    url: `${trimTrailingSlash(CHECKLIST_BASE)}/checklists/?refresh=1&q=${encodeURIComponent(PRODUCT_NAME)}`
  },
  {
    label: `Checklist Vault - ${titleCase(SPORT || "Sport")} Filter`,
    url: `${trimTrailingSlash(CHECKLIST_BASE)}/checklists/?refresh=1&sport=${encodeURIComponent(SPORT || "")}&q=${encodeURIComponent(PRODUCT_NAME)}`
  }
];

await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  colorScheme: "dark"
});

const results = [];

try {
  for (const item of chatbotQueries) {
    results.push(await testChatbotQuery(context, item));
  }

  for (const item of checklistChecks) {
    results.push(await testChecklistUrl(context, item));
  }
} finally {
  await browser.close();
}

const failed = results.filter(result => !result.ok);
await writeReport(results);

if (failed.length) {
  failed.forEach(result => {
    console.error(`\nFAILED: ${result.name}`);
    console.error(`URL: ${result.url}`);
    if (result.error) console.error(`Error: ${result.error}`);
    (result.checks || []).filter(check => !check.ok).forEach(check => {
      console.error(`- ${check.label}`);
      if (check.expected) console.error(`  Expected: ${check.expected}`);
      if (check.unwanted) console.error(`  Unwanted: ${check.unwanted}`);
    });
    if (result.text_excerpt) console.error(`Excerpt: ${result.text_excerpt}`);
    if (result.screenshot) console.error(`Screenshot: ${result.screenshot}`);
  });
  console.error(`Visual product test failed: ${failed.length} issue(s).`);
  process.exit(1);
}

console.log("Visual product test passed.");

async function testChatbotQuery(context, item) {
  const page = await context.newPage();
  const url = `${trimTrailingSlash(CHATBOT_BASE)}/?q=${encodeURIComponent(item.query)}`;
  const result = baseResult(`ChatBot - ${item.label}`, url);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForSettledChatbot(page);

    const bodyText = await page.locator("body").innerText({ timeout: 10000 });
    result.text_excerpt = buildTextExcerpt(bodyText);
    const checks = [];

    if (item.kind === "ambiguous") {
      const clarified = normalizeText(bodyText).includes(normalizeText("Which product should I use?"));
      const openedSingleMatch = normalizeText(bodyText).includes(normalizeText("Product Profile")) &&
        normalizeText(bodyText).includes(normalizeText(PRODUCT_NAME));

      checks.push({
        label: "Expected clarify list or direct single-match product profile",
        ok: clarified || openedSingleMatch,
        expected: "Clarify list or Product Profile"
      });
      checks.push(assertIncludes(bodyText, stripSportSuffix(PRODUCT_NAME), "Expected current product option"));
    } else if (item.kind === "checklist") {
      checks.push(assertAnyIncludes(bodyText, ["Checklist", "Rows", "Base", "Autograph", "Insert", "Parallel"], "Expected checklist response"));
      checks.push(assertProductNameMatch(bodyText, "Expected product title"));
      checks.push(assertNotIncludes(bodyText, "Which product should I use?", "Exact checklist query should not need clarification"));
      checks.push(assertNotIncludes(bodyText, "No rows found", "Checklist rows should load"));
    } else {
      checks.push(assertIncludes(bodyText, "Product Profile", "Expected result type"));
      checks.push(assertProductNameMatch(bodyText, "Expected product title"));
    }

    checks.push(assertNotIncludes(bodyText, "Something went wrong", "No fatal error"));
    checks.push(assertNotIncludes(bodyText, "The chat could not load data", "No chat load error"));
    checks.push(assertNotIncludes(bodyText, "Thinking...", "No stuck thinking state"));

    result.checks = checks;
    result.ok = checks.every(check => check.ok);
    if (!result.ok) result.screenshot = await saveScreenshot(page, slug(item.label));
  } catch (err) {
    result.ok = false;
    result.error = err && err.message ? err.message : String(err);
    result.screenshot = await saveScreenshot(page, slug(item.label));
  } finally {
    await page.close();
  }

  return result;
}

async function testChecklistUrl(context, item) {
  const page = await context.newPage();
  const result = baseResult(item.label, item.url);

  try {
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForChecklist(page);

    const bodyText = await page.locator("body").innerText({ timeout: 10000 });
    result.text_excerpt = buildTextExcerpt(bodyText);
    const checks = [
      assertProductNameMatch(bodyText, "Expected product title or dropdown result"),
      assertAnyIncludes(bodyText, ["Base", "Insert", "Autograph", "Parallel", "Checklist"], "Expected checklist content"),
      assertNotIncludes(bodyText, "No matching product found", "Product should match"),
      assertNotIncludes(bodyText, "No rows found", "Rows should load"),
      assertNotIncludes(bodyText, "Loading results...", "No stuck loading state")
    ];

    result.checks = checks;
    result.ok = checks.every(check => check.ok);
    if (!result.ok) result.screenshot = await saveScreenshot(page, slug(item.label));
  } catch (err) {
    result.ok = false;
    result.error = err && err.message ? err.message : String(err);
    result.screenshot = await saveScreenshot(page, slug(item.label));
  } finally {
    await page.close();
  }

  return result;
}

async function waitForSettledChatbot(page) {
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return /Product Profile|Checklist|Rows|Which product should I use\?|Something went wrong|Try another search/i.test(text);
  }, { timeout: 60000 });
  await page.waitForTimeout(750);
}

async function waitForChecklist(page) {
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return /Checklist Vault|Search Results|Base|Autograph|No matching product found|No rows found/i.test(text);
  }, { timeout: 60000 });
  await page.waitForTimeout(750);
}

async function saveScreenshot(page, name) {
  const screenshotPath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function writeReport(results) {
  const jsonPath = path.join(OUT_DIR, "visual-product-test.json");
  const markdownPath = path.join(OUT_DIR, "visual-product-test.md");
  await fs.writeFile(jsonPath, JSON.stringify({
    product_name: PRODUCT_NAME,
    product_code: CODE,
    sport: SPORT,
    app_base: APP_BASE,
    chatbot_base: CHATBOT_BASE,
    checklist_base: CHECKLIST_BASE,
    generated_at: new Date().toISOString(),
    results
  }, null, 2));

  const lines = [
    `# Visual Product Test`,
    ``,
    `Product: ${PRODUCT_NAME}`,
    CODE ? `Code: ${CODE}` : "",
    SPORT ? `Sport: ${SPORT}` : "",
    `ChatBot base: ${CHATBOT_BASE}`,
    `Checklist base: ${CHECKLIST_BASE}`,
    ``,
    `| Check | Status | URL |`,
    `|---|---:|---|`
  ].filter(line => line !== "");

  results.forEach(result => {
    lines.push(`| ${escapePipe(result.name)} | ${result.ok ? "PASS" : "FAIL"} | ${result.url} |`);
    if (result.error) lines.push(`| ${escapePipe(result.name + " error")} | ${escapePipe(result.error)} | |`);
    (result.checks || []).forEach(check => {
      const detail = check.ok
        ? ""
        : escapePipe(check.expected ? `Expected: ${check.expected}` : check.unwanted ? `Unwanted: ${check.unwanted}` : "");
      lines.push(`| ${escapePipe(" - " + check.label)} | ${check.ok ? "PASS" : "FAIL"} | ${detail} |`);
    });
    if (result.screenshot) lines.push(`| ${escapePipe(" - screenshot")} | ${result.screenshot} | |`);
    if (!result.ok && result.text_excerpt) lines.push(`| ${escapePipe(" - page excerpt")} | ${escapePipe(result.text_excerpt)} | |`);
  });

  await fs.writeFile(markdownPath, lines.join("\n") + "\n");
}

function baseResult(name, url) {
  return {
    name,
    url,
    ok: false,
    checks: []
  };
}

function assertIncludes(text, expected, label) {
  return {
    label,
    ok: normalizeText(text).includes(normalizeText(expected)),
    expected
  };
}

function assertProductNameMatch(text, label) {
  const candidates = uniqueStrings([
    PRODUCT_NAME,
    stripSportSuffix(PRODUCT_NAME)
  ]);
  const normalized = normalizeText(text);

  return {
    label,
    ok: candidates.some(candidate => normalized.includes(normalizeText(candidate))),
    expected: candidates.join(" | ")
  };
}

function assertAnyIncludes(text, expectedList, label) {
  const normalized = normalizeText(text);
  return {
    label,
    ok: expectedList.some(expected => normalized.includes(normalizeText(expected))),
    expected: expectedList.join(" | ")
  };
}

function assertNotIncludes(text, unwanted, label) {
  return {
    label,
    ok: !normalizeText(text).includes(normalizeText(unwanted)),
    unwanted
  };
}

function buildShortProductQuery(name) {
  const withoutYear = stripYear(name);
  const withoutMaker = withoutYear.replace(/\b(Topps|Panini|Upper Deck|Bowman|Leaf)\b/i, "").replace(/\s+/g, " ").trim();
  return [productYear, withoutMaker].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function stripYear(value) {
  return String(value || "").replace(/\b(?:19|20)\d{2}(?:-\d{2})?\b/g, "").replace(/\s+/g, " ").trim();
}

function stripSportSuffix(value) {
  return String(value || "").replace(/\s+(Baseball|Basketball|Football|Hockey|Soccer)$/i, "").trim();
}

function unique(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.query;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = normalizeText(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildTextExcerpt(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function cleanEnv(key) {
  return String(process.env[key] || "").trim();
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/g, "");
}

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, char => char.toUpperCase());
}

function slug(value) {
  return String(value || "check").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function escapePipe(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
