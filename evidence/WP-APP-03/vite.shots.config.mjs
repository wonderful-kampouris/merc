// Screenshot-only bundle for WP-APP-03 evidence: builds app/app/dev (the dev entry that mounts <App/>) as a normal
// static site, with the runner SDK shim, React bundled in, and the same use-sync-external-store ESM aliases the
// production build uses. react-router (imported by ui-base's BaseUrlTabs, unused by the app) is stubbed.
// Build: npx vite build --config ../../evidence/WP-APP-03/vite.shots.config.mjs   (run from app/app)
import { fileURLToPath } from "node:url";
import react from "../../app/app/node_modules/@vitejs/plugin-react/dist/index.js";

const app = (p) => fileURLToPath(new URL(`../../app/app/${p}`, import.meta.url));
export default {
  plugins: [
    react(),
    // Swap the contracts module the client uses for the undo fixture (mock-fixture.ts). Harness only.
    {
      name: "merc-record-undo-fixture",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "../contracts" && importer?.replace(/\\/g, "/").endsWith("/src/lib/client.ts")) return fileURLToPath(new URL("./mock-fixture.ts", import.meta.url));
        return null;
      },
    },
  ],
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
  build: { outDir: "/tmp/merc-app03-shots", emptyOutDir: true, target: "chrome91" },
};
