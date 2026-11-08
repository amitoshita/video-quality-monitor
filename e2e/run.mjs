// Browser tests: drives the real app in Chrome with a fake camera and checks the result in the
// backend. Every scenario creates sessions, so run it against a local backend.
//
//   node run.mjs                 all scenarios
//   node run.mjs live offline    selected scenarios
//
// Env: E2E_APP_URL (default http://localhost:5173), E2E_API_URL (default http://localhost:8000),
//      CHROME_PATH (optional; otherwise the installed Google Chrome is used).
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.E2E_APP_URL ?? "http://localhost:5173";
const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(API) && process.env.E2E_ALLOW_REMOTE !== "1") {
  console.error(`Refusing to create test sessions on ${API}. Set E2E_ALLOW_REMOTE=1 to override.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------- helpers

let failures = 0;
function check(description, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${description}${detail ? `  (${detail})` : ""}`);
}

async function launch({ video, deny = false } = {}) {
  const args = ["--use-fake-device-for-media-stream"];
  args.push(deny ? "--deny-permission-prompts" : "--use-fake-ui-for-media-stream");
  if (video) {
    const file = join(HERE, "videos", video);
    if (!existsSync(file)) throw new Error(`missing ${file}: run "npm run videos" first`);
    args.push(`--use-file-for-fake-video-capture=${file}`);
  }
  const browser = await chromium.launch({
    headless: true,
    args,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(APP);
  return { browser, context, page, errors };
}

const toggle = (page) => page.locator("button.button").first();

async function waitForStart(page) {
  await page.getByRole("button", { name: "Start" }).waitFor({ timeout: 90_000 });
  // The face detector preloads in the background; Start would wait for it anyway.
  await page.getByText(/Face detection: (GPU|CPU)/).waitFor({ timeout: 60_000 });
}

async function startSession(page) {
  await toggle(page).click();
  await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 30_000 });
}

const facts = async (page) => (await page.locator(".facts li").allInnerTexts()).join(" | ");
const tile = async (page, name) =>
  (await page.locator(".tile", { hasText: name }).first().innerText()).replace(/\s+/g, " ");
const api = async (path) => (await fetch(API + path)).json();
const sessionCount = async () => (await api("/sessions?limit=1")).total;

async function latestSession() {
  const { items } = await api("/sessions?limit=1");
  return api(`/sessions/${items[0].id}`);
}

/** t runs 1..n with no gaps and no duplicates. */
function contiguous(detail) {
  const ts = detail.samples.map((s) => s.t);
  return { ok: ts.length > 0 && ts.every((t, i) => t === i + 1), ts: `${ts.length} samples, t=${ts[0]}..${ts.at(-1)}` };
}

// -------------------------------------------------------------------------------- scenarios

const scenarios = {
  async live() {
    const { browser, page, errors } = await launch();
    await waitForStart(page);
    await startSession(page);
    await sleep(6500);
    const running = await facts(page);
    check("camera opened at a real resolution", /Camera: \d+×\d+/.test(running), running);
    check("frames come from requestVideoFrameCallback", running.includes("requestVideoFrameCallback"));
    check("a verdict is shown", /Good|Poor/.test(await page.locator(".verdict").innerText()));
    await toggle(page).click();
    await page.getByRole("button", { name: "Start" }).waitFor();
    check("Stop releases the camera", (await page.evaluate(() => document.querySelector("video").srcObject)) === null);
    await sleep(2500);
    const session = await latestSession();
    const { ok, ts } = contiguous(session);
    check("backend has one sample per second, t contiguous from 1", ok && session.samples.length >= 5, ts);
    check("every second has real frames (fps > 0)", session.samples.every((s) => s.fps > 0));
    check("the session is ended", session.ended_at !== null);
    check("no page errors", errors.length === 0, errors.join("; "));
    await browser.close();
  },

  async dark() {
    const { browser, page } = await launch({ video: "black.y4m" });
    await waitForStart(page);
    await startSession(page);
    await sleep(3500);
    const brightness = await tile(page, "Brightness");
    check("black video: brightness 0.0, flagged", brightness.includes("✕ 0.0"), brightness);
    await browser.close();
  },

  async bright() {
    const { browser, page } = await launch({ video: "white.y4m" });
    await waitForStart(page);
    await startSession(page);
    await sleep(3500);
    const brightness = await tile(page, "Brightness");
    check("white video: brightness 255.0, flagged", brightness.includes("✕ 255.0"), brightness);
    await browser.close();
  },

  async motion() {
    const { browser, page } = await launch({ video: "noise.y4m" });
    await waitForStart(page);
    await startSession(page);
    await sleep(3500);
    const motion = await tile(page, "Motion");
    const { thresholds } = await api("/config");
    const value = Number(/([\d.]+)/.exec(motion)?.[1]);
    check(`noise video: motion above ${thresholds.max_motion}, flagged`, motion.includes("✕") && value > thresholds.max_motion, motion);
    await browser.close();
  },

  async denied() {
    const { browser, page } = await launch({ deny: true });
    await waitForStart(page);
    const before = await sessionCount();
    await toggle(page).click();
    await page.locator(".notice-error").waitFor({ timeout: 10_000 });
    const notice = await page.locator(".notice-error").innerText();
    check("denied camera: a clear message", notice.includes("Camera access is blocked"), notice.slice(0, 60));
    check("denied camera: no session created", (await sessionCount()) === before);
    await browser.close();
  },

  async offline() {
    const { browser, context, page } = await launch();
    await waitForStart(page);
    await startSession(page);
    await sleep(3000);
    await context.setOffline(true);
    await sleep(5000);
    check("offline: the problem is shown", (await facts(page)).includes("Connection problem"));
    await sleep(5000);
    await context.setOffline(false);
    await page.getByText("All samples delivered").waitFor({ timeout: 8000 }).catch(() => {});
    check("back online: everything delivered within seconds", (await facts(page)).includes("All samples delivered"));
    await sleep(1500);
    await toggle(page).click();
    await sleep(4000);
    const session = await latestSession();
    const { ok, ts } = contiguous(session);
    check("10 s outage: no sample lost or duplicated", ok, ts);
    check("the session is ended", session.ended_at !== null);
    await browser.close();
  },

  async stopOffline() {
    const { browser, context, page } = await launch();
    await waitForStart(page);
    await startSession(page);
    await sleep(2200);
    await context.setOffline(true);
    await sleep(2500);
    await toggle(page).click();
    await page.getByRole("button", { name: "Start" }).waitFor({ timeout: 2000 });
    check("Stop while offline returns to idle at once", true);
    check("pending samples of the stopped session are shown", (await page.locator(".notice").allInnerTexts()).some((t) => t.startsWith("Previous session:")));
    await context.setOffline(false);
    await startSession(page);
    await sleep(3500);
    await toggle(page).click();
    await sleep(6000);
    const { items } = await api("/sessions?limit=2");
    const [second, first] = await Promise.all(items.map((s) => api(`/sessions/${s.id}`)));
    for (const [name, session] of [["stopped offline", first], ["started right after", second]]) {
      const { ok, ts } = contiguous(session);
      check(`${name}: complete and ended`, ok && session.ended_at !== null, ts);
    }
    await browser.close();
  },

  async startStop() {
    const { browser, page } = await launch();
    await waitForStart(page);
    const before = await sessionCount();
    for (let i = 0; i < 5; i++) {
      await startSession(page);
      await sleep(1300);
      await toggle(page).click();
      await page.getByRole("button", { name: "Start" }).waitFor();
    }
    await sleep(2500);
    const { items, total } = await api("/sessions?limit=5");
    check("Start/Stop ×5: five sessions", total - before === 5);
    check("Start/Stop ×5: all ended", items.every((s) => s.ended_at !== null));
    check("camera released", (await page.evaluate(() => document.querySelector("video").srcObject)) === null);
    await browser.close();
  },

  async history() {
    const { browser, page } = await launch();
    await waitForStart(page);
    await startSession(page);
    await sleep(4300);

    // An accidental click on History asks first; declining keeps the session running.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("link", { name: "History" }).click();
    await sleep(500);
    check("History while running asks; Cancel keeps the session", (await toggle(page).innerText()) === "Stop" && !page.url().includes("history"));
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("link", { name: "History" }).click();
    await page.locator(".history-row").first().waitFor();
    check("confirming opens History", page.url().endsWith("#/history"));
    await sleep(2000);
    const latest = (await api("/sessions?limit=1")).items[0];
    check("confirming stopped the session", latest.ended_at !== null);

    const firstLink = await page.locator(".history-row a").first().getAttribute("href");
    check("newest session is listed first", firstLink?.endsWith(latest.id) === true);
    // Opened right after Stop, the list may predate the last delivered second; it refreshes
    // by itself once delivery finishes.
    const final = await api(`/sessions/${latest.id}`);
    await page.locator(".history-row").first().filter({ hasText: `${final.summary.duration_s} s` }).waitFor({ timeout: 10_000 }).catch(() => {});
    const firstRow = await page.locator(".history-row").first().innerText();
    check("its row shows the complete session", firstRow.includes(`\t${final.summary.duration_s} s\t`), firstRow.replace(/\t/g, " · "));
    await page.locator(".history-row a").first().click();
    await page.locator(".chart").first().waitFor();
    check("details show the summary and the charts", (await page.locator(".tile").count()) === 4 && (await page.locator(".chart").count()) === 3);
    await page.getByRole("link", { name: "← Back to history" }).click();
    check("Back returns to the list", page.url().endsWith("#/history"));

    await page.goto(`${APP}/#/sessions/00000000-0000-4000-8000-000000000000`);
    await page.getByText("This session does not exist.").waitFor();
    check("unknown session: clear message", true);
    await browser.close();
  },
};

// ------------------------------------------------------------------------------------- main

const selected = process.argv.slice(2);
const names = selected.length > 0 ? selected : Object.keys(scenarios);
console.log(`App ${APP} · API ${API}`);
for (const name of names) {
  if (!scenarios[name]) {
    console.log(`\nunknown scenario "${name}"; choose from: ${Object.keys(scenarios).join(", ")}`);
    failures += 1;
    continue;
  }
  const started = Date.now();
  console.log(`\n${name}`);
  try {
    await scenarios[name]();
  } catch (error) {
    check("scenario ran to completion", false, String(error).split("\n")[0]);
  }
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
console.log(failures === 0 ? "\nAll browser checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
