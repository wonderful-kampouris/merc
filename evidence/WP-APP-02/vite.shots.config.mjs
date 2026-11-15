// Screenshot-only static bundle for WP-APP-02 evidence: builds app/app/dev (mounts <App/>) with the runner SDK shim,
// React bundled, the production use-sync-external-store aliases, and react-router stubbed (pnpm dev fails on it).
// Build (from app/app): npx vite build --config ../../evidence/WP-APP-02/vite.shots.config.mjs
import { fileURLToPath } from "node:url";
import react from "../../app/app/node_modules/@vitejs/plugin-react/dist/index.js";

const app = (p) => fileURLToPath(new URL(`../../app/app/${p}`, import.meta.url));
// Route only client.ts's contracts import through the seed-shaped overlay (seedMock.ts); screens and tests are untouched.
const seedMock = {
  name: "merc-seed-mock",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === "../contracts" && importer?.endsWith("/src/lib/client.ts")) return fileURLToPath(new URL("./seedMock.ts", import.meta.url));
  },
};
export default {
  plugins: [seedMock, react()],
  root: app("dev"),
  base: "./",
  resolve: {
    alias: [
      { find: "@wonderful/app-sdk", replacement: app("runner/sdk-shim.ts") },
      { find: /^react-router$/, replacement: fileURLToPath(new URL("./react-router-stub.mjs", import.meta.url)) },
      { find: /^use-sync-external-store(\/shim)?\/with-selector(\.js)?$/, replacement: app("infra/use-sync-external-store/with-selector.ts") },
      { find: /^use-sync-external-store(\/shim)?(\/index\.js)?$/, replacement: app("infra/use-sync-external-store/shim.ts") },
    ],
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: "/tmp/merc-app02-shots", emptyOutDir: true, target: "chrome91" },
};
