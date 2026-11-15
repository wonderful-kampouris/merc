// Phone-size screenshots of the WP-APP-06 screens in mock mode, via the Chrome DevTools protocol.
// Usage (from app/app, with the shots dev server on :5306):  node ../../evidence/WP-APP-06/tools/shoot.mjs <chrome-binary>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(`${process.cwd()}/package.json`);
const WebSocket = require("ws");
const chrome = process.argv[2];
const BASE = process.env.SHOTS_BASE ?? "http://localhost:5306/";
const OUT = fileURLToPath(new URL("../", import.meta.url));
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, ["--headless", "--disable-gpu", "--remote-debugging-port=9336", `--window-size=${W},${H}`, "--user-data-dir=/tmp/wp06/chrome-profile", "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch("http://127.0.0.1:9336/json/list")).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
const logs = [];
ws.on("message", (m) => {
  const msg = JSON.parse(m);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") logs.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
});
const send = (method, params = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); j(new Error(`CDP ${method} timed out`)); }, 15000);
    pending.set(i, (m) => { clearTimeout(timer); r(m); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
// The dev SDK shim reads the bootstrap the local runner normally serves; mock mode never calls the proxy.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__WONDERFUL_RUNNER__ = ${JSON.stringify({
    context: { tenantId: "local", workspaceId: "local", userId: "shots", userName: "Screenshots", appRole: "manager", appRoles: ["manager"], theme: "light", apiBaseUrl: "" },
    proxyPrefix: "/proxy",
  })};`,
});
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });

/** Wait until `text` is on the page. */
async function waitText(text, ms = 8000) {
  for (let t = 0; t < ms; t += 200) {
    if (await evaluate(`document.body && document.body.innerText.includes(${JSON.stringify(text)})`)) return true;
    await sleep(200);
  }
  throw new Error(`timeout waiting for "${text}"`);
}
const click = (text, sel = "button") =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.innerText.trim() === ${JSON.stringify(text)} || b.getAttribute("aria-label") === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
const typeInto = (sel, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const setFile = (name, content) =>
  evaluate(`(() => { const input = document.querySelector('input[type=file]'); if (!input) return false; const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: "text/csv" })); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);

async function shot(name) {
  await sleep(400);
  const { result } = await send("Page.getLayoutMetrics");
  const height = Math.min(Math.ceil(result.cssContentSize.height), 4000);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: Math.max(height, H), scale: 1 } });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(r.result.data, "base64"));
  console.log(`saved ${name}.png (${W}x${Math.max(height, H)} css px)`);
}
async function open(route, lang = "el") {
  await evaluate(`localStorage.setItem("merc.lang", ${JSON.stringify(lang)})`);
  await send("Page.navigate", { url: `${BASE}?mock=1&role=manager&route=${encodeURIComponent(route)}` });
  await sleep(600);
}


/** Elements whose right edge passes the viewport (the overflow the verifier saw), outside the scrolling nav. */
const overflow = () => evaluate(`(() => { const W = document.documentElement.clientWidth; const out = []; for (const el of document.querySelectorAll(".merc-mgmt__main *")) { const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1) out.push((el.className && el.className.baseVal === undefined ? String(el.className).slice(0, 60) : el.tagName) + " right=" + Math.round(r.right)); } return { docWidth: document.documentElement.scrollWidth, viewport: W, offenders: out.slice(0, 8), count: out.length }; })()`);

mkdirSync(OUT, { recursive: true });
await send("Page.navigate", { url: BASE });
await sleep(800);
const screens = [
  ["dashboard", "/mgmt/dashboard", { el: "Πίνακας", en: "Dashboard" }],
  ["pipeline", "/mgmt/pipeline", { el: "Bistro", en: "Bistro" }],
  ["targets", "/mgmt/targets", { el: "Πώληση", en: "Sales" }],
  ["competition", "/mgmt/competition", { el: "Aroma", en: "Aroma" }],
];
let failed = 0;
for (const [name, route, wait] of screens) {
  for (const lang of ["el", "en"]) {
    try {
      await open(route, lang);
      await waitText(wait[lang]).catch(() => {});
      await sleep(600);
      const o = await overflow();
      console.log(`${name}-${lang}: docWidth=${o.docWidth} viewport=${o.viewport} overflowing=${o.count}${o.count ? " " + JSON.stringify(o.offenders) : ""}`);
      if (o.count) failed++;
      await shot(`${name}-phone-${lang}`);
    } catch (e) { failed++; console.log(`${name}-${lang} FAILED: ${e.message}`); }
  }
}
// The drill-down on the at-risk tile (REQ-DSH-002) and the per-rep drill on revenue.
try {
  await open("/mgmt/dashboard", "en"); await waitText("Customers at risk"); await sleep(600);
  await click("Open the records behind this figure: Customers at risk"); await waitText("Close"); await shot("dashboard-drill-at-risk-phone-en");
  await open("/mgmt/dashboard", "en"); await waitText("Revenue"); await sleep(600);
  await click("Open the records behind this figure: Revenue"); await waitText("Close"); await shot("dashboard-drill-revenue-by-rep-phone-en");
} catch (e) { failed++; console.log(`drill FAILED: ${e.message}`); }
console.log(logs.length ? `page errors:\n${[...new Set(logs)].join("\n")}` : "page errors: none");
ws.close();
proc.kill();
process.exit(failed ? 1 : 0);
