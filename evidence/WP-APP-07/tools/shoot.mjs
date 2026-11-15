// Phone-size screenshots of the WP-APP-07 screens in mock mode, via the Chrome DevTools protocol.
// Usage (from app/app, with the shots dev server on :5307):  node ../../evidence/WP-APP-07/tools/shoot.mjs <chrome-binary>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(`${process.cwd()}/package.json`);
const WebSocket = require("ws");
const chrome = process.argv[2];
const BASE = process.env.SHOTS_BASE ?? "http://localhost:5307/";
const OUT = fileURLToPath(new URL("../", import.meta.url));
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, ["--headless", "--disable-gpu", "--remote-debugging-port=9333", `--window-size=${W},${H}`, "--user-data-dir=/tmp/wp07/chrome-profile", "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find((t) => t.type === "page"); } catch {}
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
    context: { tenantId: "local", workspaceId: "local", userId: "shots", userName: "Screenshots", appRole: "admin", appRoles: ["admin"], theme: "light", apiBaseUrl: "" },
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
  await send("Page.navigate", { url: `${BASE}?mock=1&role=admin&route=${encodeURIComponent(route)}` });
  await sleep(600);
}

mkdirSync(OUT, { recursive: true });
await send("Page.navigate", { url: BASE });
await sleep(800);
const steps = [
  async () => { await open("/mgmt/campaigns"); await waitText("Espresso Nuovo to cafés"); await shot("01-campaigns-el"); },
  async () => {
    await typeInto("textarea", "Προώθησε το Espresso Nuovo στα καφέ σε Βορρά και Κέντρο αυτή την εβδομάδα");
    await click("Συμπλήρωση φόρμας"); await waitText("Δεν αναγνωρίστηκαν"); await shot("02-campaigns-draft-el");
  },
  async () => { await open("/mgmt/campaigns"); await waitText("Espresso Nuovo to cafés"); await click("Χωνί"); await waitText("Εμφανίστηκε"); await shot("03-campaigns-funnel-el"); },
  async () => { await open("/mgmt/territories"); await waitText("North"); await shot("04-territories-el"); },
  async () => { await open("/mgmt/settings"); await waitText("Δικαιώματα AI"); await shot("05-settings-ai-el"); },
  async () => { await click("Οργανισμός", "[role=tab], button"); await waitText("Επωνυμία εταιρείας"); await shot("06-settings-org-el"); },
  async () => { await open("/mgmt/users"); await waitText("Eleni Markou"); await shot("07-users-el"); },
  async () => { await click("Πρόσκληση χρήστη"); await sleep(300); await click("Αποστολή πρόσκλησης"); await waitText("Ο πωλητής χρειάζεται διευθυντή"); await shot("08-users-invite-validation-el"); },
  async () => { await open("/mgmt/import"); await waitText("Ανέβασμα και αντιστοίχιση"); await shot("09-import-el"); },
  async () => {
    await setFile("pelates.csv", "Επωνυμία;ΑΦΜ;Τ.Κ.;Τηλέφωνο;Σχόλια\nΦούρνος Λόφος;094000000;15231;2100000000;καλός πελάτης\nCafé Miltos;;15232;2100000001;\n");
    await waitText("pelates.csv"); await click("Ανέβασμα και αντιστοίχιση"); await waitText("Αντιστοίχιση στηλών"); await shot("10-import-mapping-el");
  },
  async () => { await open("/mgmt/settings/gdpr"); await waitText("Δοκιμαστικές επαφές"); await shot("11-gdpr-el"); },
  async () => { await click("Miltos Papadakis", "button, span, [role=button], div"); await sleep(300); await click("Εξαγωγή δεδομένων"); await waitText("Λήψη JSON"); await click("Διαγραφή προσώπου"); await waitText("Πληκτρολογήστε"); await shot("12-gdpr-erase-confirm-el"); },
  async () => { await open("/mgmt/ai-log"); await waitText("Ιστορικό AI"); await waitText("summary sample"); await shot("13-ai-log-el"); },
  async () => { await open("/mgmt/campaigns", "en"); await waitText("New campaign from text"); await shot("14-campaigns-en"); },
  async () => { await open("/mgmt/settings", "en"); await waitText("AI permissions"); await shot("15-settings-en"); },
];
let failed = 0;
for (const [i, s] of steps.entries()) {
  try { await s(); } catch (e) { failed++; console.log(`step ${i + 1} FAILED: ${e.message}`); await shot(`fail-step-${i + 1}`); }
}
console.log(logs.length ? `page errors:\n${[...new Set(logs)].join("\n")}` : "page errors: none");
ws.close();
proc.kill();
process.exit(failed ? 1 : 0);
