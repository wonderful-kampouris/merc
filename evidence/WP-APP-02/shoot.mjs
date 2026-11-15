// Phone-size screenshots of WP-APP-02 screens in mock mode, via the Chrome DevTools Protocol.
// usage: node shoot.mjs <devServerUrl> <outDir> <chromeHeadlessShell> <wsModulePath>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [base, outDir, chromeBin, wsPath] = process.argv.slice(2);
const { default: WebSocket } = await import(wsPath);
const port = Number(process.env.MERC_CDP_PORT ?? 9477);
const chrome = spawn(chromeBin, [`--remote-debugging-port=${port}`, "--no-first-run", "--hide-scrollbars", "--lang=el-GR", `--user-data-dir=/tmp/wpapp02-chrome-${Date.now()}`, "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (m) => {
  const msg = JSON.parse(m.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__WONDERFUL_RUNNER__ = { proxyPrefix: "/__none", context: { tenantId: "t", workspaceId: "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464", userId: "u-rep", userName: "Nikos (rep)", appRole: "rep", theme: "light", apiBaseUrl: "" } };`,
});

const go = async (route, setup = "") => {
  await send("Page.navigate", { url: `${base}/index.html?mock=1&route=${encodeURIComponent(route)}` });
  await sleep(600);
  if (setup) {
    await evaluate(setup);
    await send("Page.reload", {});
  }
  await waitIdle();
};
// Open a visit card via the Today -> Customers hand-off; retry if the page raced the storage write.
const card = async (lang, accountId) => {
  for (let i = 0; i < 4; i++) {
    // Write the hand-off on the current (same-origin) page, then load Customers once, so no half-mounted page consumes it.
    await evaluate(`localStorage.setItem("merc.lang","${lang}"); sessionStorage.setItem("merc.customers.focus","${accountId}")`);
    await send("Page.navigate", { url: `${base}/index.html?mock=1&route=${encodeURIComponent("/rep/customers")}` });
    await waitIdle();
    if (await evaluate(`/Back to list|Πίσω στη λίστα/.test(document.body.innerText)`)) return;
    await sleep(500);
  }
  throw new Error(`visit card ${accountId} did not open; page text: ${(await evaluate("document.body.innerText")).slice(0, 600).replace(/\n+/g, " | ")}; focus=${await evaluate(`sessionStorage.getItem("merc.customers.focus")`)}`);
};
const waitIdle = async () => {
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const busy = await evaluate(`!!document.querySelector('[aria-busy="true"]') || !document.querySelector('.merc-root')`);
    if (!busy) break;
  }
  await sleep(500);
};
const phone = (height) => send("Emulation.setDeviceMetricsOverride", { width: 390, height, deviceScaleFactor: 2, mobile: true });
// Full-page shots grow the viewport to the content height, so the fixed bottom nav sits at the bottom of the image.
const shot = async (name, full = true) => {
  const m = await send("Page.getLayoutMetrics");
  const h = full ? Math.max(844, Math.ceil(m.cssContentSize.height)) : 844;
  if (full) {
    await phone(h);
    await sleep(400);
  }
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: h, scale: 1 } });
  if (full) await phone(844);
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, "base64"));
  const text = await evaluate(`document.body.innerText`);
  writeFileSync(join(outDir, `${name}.txt`), text);
  console.log(`${name}.png ${390}x${h}`);
};

const MILTOS = "59b5e454-cc4b-5fab-939b-a50c78e8aa9b";
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
// Today, Greek default (mock mode)
await go("/rep/today", `localStorage.clear(); sessionStorage.clear(); localStorage.setItem("merc.lang","el")`);
await shot("today-el");
await shot("today-el-viewport", false);
// Today offline: data loaded once (cache written), then airplane mode
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(400);
await evaluate(`window.dispatchEvent(new Event("offline"))`);
await waitIdle();
console.log("navigator.onLine =", await evaluate("navigator.onLine"), "cache key present =", await evaluate(`!!localStorage.getItem("merc.today.v1")`));
await shot("today-el-offline", false);
await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
// Today, English
await go("/rep/today", `localStorage.setItem("merc.lang","en")`);
await shot("today-en");
// Customers list
await go("/rep/customers", `localStorage.setItem("merc.lang","el")`);
await shot("customers-list-el");
// Customer visit card (handoff from Today)
await card("el", MILTOS);
await shot("customer-card-el");
await card("en", MILTOS);
await shot("customer-card-en");
await card("en", AVRA);
await shot("prospect-card-en");
await card("el", AVRA);
await shot("prospect-card-el");
await go("/rep/customers", `localStorage.setItem("merc.lang","en"); sessionStorage.removeItem("merc.customers.focus")`);
await shot("customers-list-en");

ws.close();
chrome.kill();
