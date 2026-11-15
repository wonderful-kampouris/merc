// Phone-size screenshots of /rep/record in mock mode via Chrome DevTools Protocol.
// usage: node shoot.mjs <base-url> <out-dir>   (needs the app dev server running and Google Chrome installed)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(new URL("../../app/app/package.json", import.meta.url));
const WebSocket = require("ws");
const base = process.argv[2] ?? "http://localhost:5187";
const out = process.argv[3] ?? ".";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = Number(process.env.MERC_CDP_PORT ?? 9471); // unique: other builders may run Chrome on 9333
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "merc-shot-"))}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page" && (t.url === "about:blank" || t.url.startsWith(base)));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("chrome did not start");
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (m) => {
  const msg = JSON.parse(String(m));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === "Runtime.exceptionThrown") log.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") log.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (name, full = false) => {
  // Full-page shots grow the viewport to the page height so the sticky tab bar sits at the real page bottom
  // (with captureBeyondViewport it stays at y=844 and covers content mid-page).
  if (full) {
    const h = await evaluate("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: Math.max(844, h), deviceScaleFactor: 2, mobile: true });
    await sleep(300);
  }
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  if (full) {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(100);
  }
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
  log.push(`saved ${name}.png`);
};
const click = (text) =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!b) return false; b.click(); return true; })()`);
const type = (value) =>
  evaluate(`(() => { const t = document.querySelector('textarea'); if (!t) return false; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const text = () => evaluate("document.body.innerText");
const step = async (label, fn) => {
  const r = await fn();
  log.push(`${label}: ${JSON.stringify(r)}`);
  return r;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
// The runner SDK shim needs this bootstrap (the real runner server injects it). Mock mode never calls the proxy.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__WONDERFUL_RUNNER__ = ${JSON.stringify({ context: { tenantId: "mock", workspaceId: "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464", userId: "mock-rep", userName: "Thanasis Kyriakou", appRole: "rep", appRoles: ["rep"], theme: "light", apiBaseUrl: "https://default.api.greece-hackathon.sb.wonderful.ai" }, proxyPrefix: "/__runner" })};` });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });

const open = async (lang) => {
  await send("Page.navigate", { url: `${base}/?mock=1&route=/rep/record` });
  await sleep(1500);
  await evaluate(`localStorage.removeItem('merc.record.queue.v1'); localStorage.setItem('merc.lang', '${lang}'); localStorage.setItem('merc.mock', '1'); true`);
  await send("Page.reload");
  await sleep(2500);
};

// 1. Greek default, empty state
await open("el");
await step("page url", () => evaluate("location.href"));
await step("el empty has title", async () => (await text()).includes("Καταγραφή επίσκεψης"));
await shot("01-el-empty");

// 2. Typed debrief -> mock upload -> result card
await step("click type", () => click("Γράψε το"));
await sleep(300);
await step("type", () => type("Στον Μίλτο, ο μύλος φτιάχτηκε. Θέλουν 12 κιλά την Πέμπτη και θα τους φέρω δείγματα."));
await sleep(200);
await shot("02-el-typing");
await step("send", () => click("Αποστολή"));
await sleep(1500);
await step("card visible", async () => (await text()).includes("Η επίσκεψη καταχωρήθηκε"));
await shot("03-el-result-card", true);

// 3. Undo (the harness fixture returns applied + undoable lines; fn:ai-action-undo answers from the contract mock)
await step("undo offered", async () => (await text()).includes("Αναίρεση"));
await step("click undo", () => click("Αναίρεση"));
await sleep(1000);
await step("line marked undone", async () => (await text()).includes("Αναιρέθηκε"));
await shot("04-el-after-undo", true);

// 4. Offline: recording queues on the phone
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await evaluate("window.dispatchEvent(new Event('offline')); true");
await sleep(300);
await step("navigator.onLine", () => evaluate("navigator.onLine"));
await step("close card", () => click("Κλείσιμο"));
await step("click type", () => click("Γράψε το"));
await sleep(200);
await step("type", () => type("Στον φούρνο Λόφος: ζητούν έκπτωση 8% για τα Χριστούγεννα."));
await step("send", () => click("Αποστολή"));
await sleep(800);
await step("queued visible", async () => (await text()).includes("σε αναμονή αποστολής"));
await shot("05-el-offline-queued", true);

// 5. Back online -> queue flushes -> card
await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await evaluate("window.dispatchEvent(new Event('online')); true");
await sleep(2000);
await step("card after reconnect", async () => (await text()).includes("Η επίσκεψη καταχωρήθηκε"));
await step("queue items", () => evaluate("JSON.parse(localStorage.getItem('merc.record.queue.v1')).map(i => i.status + ':' + i.idempotency_key.slice(0,8))"));
await shot("06-el-reconnected-synced", true);

// 6. English
await open("en");
await step("en title", async () => (await text()).includes("Record a visit"));
await shot("07-en-empty");
await step("click type", () => click("Type instead"));
await sleep(200);
await step("type", () => type("At Miltos the grinder is fixed, they want 12 kg on Thursday."));
await step("send", () => click("Send"));
await sleep(1500);
await shot("08-en-result-card", true);

writeFileSync(join(out, "shoot.log"), log.join("\n") + "\n");
console.log(log.join("\n"));
ws.close();
chrome.kill();
process.exit(0);
