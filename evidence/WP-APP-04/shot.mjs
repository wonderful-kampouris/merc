// Drives chrome-headless-shell over CDP: phone viewport, set lang in localStorage, open a route in mock mode, screenshot.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const WS = (await import("/Users/stefanos.k/Documents/genai/app/app/node_modules/ws/index.js")).default;
const [, , base, outDir, ...jobs] = process.argv; // job = name:route:lang
const bin = "/Users/stefanos.k/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const profile = mkdtempSync(join(tmpdir(), "wp04-chrome-"));
const chrome = spawn(bin, ["--remote-debugging-port=9334", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let wsUrl;
await new Promise((res) => chrome.stderr.on("data", (d) => { const m = /DevTools listening on (ws:\S+)/.exec(String(d)); if (m && !wsUrl) { wsUrl = m[1]; res(); } }));
const targets = await (await fetch("http://127.0.0.1:9334/json")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WS(page.webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id = 0; const pending = new Map(); const logs = [];
ws.on("message", (m) => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") logs.push(msg.params.args.map((a) => a.value ?? a.description).join(" ")); if (msg.method === "Runtime.exceptionThrown") logs.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Runtime.enable"); await send("Page.enable");
// Same bootstrap the local runner injects (runner/server.mjs); mock mode makes no proxy calls.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__WONDERFUL_RUNNER__ = ${JSON.stringify({ context: { tenantId: "local-runner-tenant", workspaceId: "local-runner-workspace", userId: "local-runner-user", userName: "Nikos (mock)", theme: "light", apiBaseUrl: "/proxy/api/v1", appRole: "rep" }, proxyPrefix: "/proxy" })};` });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
for (const job of jobs) {
  const [name, route, lang, click] = job.split("|");
  await send("Page.navigate", { url: `${base}/?mock=1` }); await wait(1500);
  await send("Runtime.evaluate", { expression: `localStorage.setItem("merc.lang","${lang}"); localStorage.setItem("merc.mock","1"); localStorage.setItem("merc.role","rep"); sessionStorage.clear();` });
  await send("Page.navigate", { url: `${base}/?mock=1&role=rep&route=${encodeURIComponent(route)}` }); await wait(3500);
  if (click) { await send("Runtime.evaluate", { expression: `(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === ${JSON.stringify(click)}); if (b) b.click(); return !!b; })()` }); await wait(1500); }
  const h = await send("Runtime.evaluate", { expression: "Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)", returnByValue: true });
  const height = Math.min(Math.max(844, h.result.result.value || 844), 4000);
  const text = await send("Runtime.evaluate", { expression: "document.body.innerText.slice(0, 600)", returnByValue: true });
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height, scale: 1 } });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.result.data, "base64"));
  console.log(`== ${name} (${route}, ${lang}${click ? ", clicked " + click : ""}) height=${height}\n${String(text.result.result.value).replace(/\n+/g, " | ").slice(0, 400)}`);
}
console.log("console errors:", logs.length ? logs.slice(0, 10) : "none");
ws.close(); chrome.kill();
