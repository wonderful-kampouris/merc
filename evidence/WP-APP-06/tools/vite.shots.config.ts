// Local dev server for WP-APP-06 screenshots: the app's own dev setup plus stubs for ui-base's optional peers
// (react-router, @tanstack/react-query are not installed in app/app, so `pnpm dev` fails to resolve them).
// Run from app/app:  npx vite --config ../../evidence/WP-APP-06/tools/vite.shots.config.ts --port 5306
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "vite";

const app = fileURLToPath(new URL("../../../app/app", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));
const req = createRequire(`${app}/package.json`);

export default defineConfig(async () => {
  const react = (await import(pathToFileURL(req.resolve("@vitejs/plugin-react")).href)).default;
  return {
    root: `${app}/dev`,
    plugins: [react()],
    server: { fs: { allow: [app, here] } },
    resolve: {
      alias: [
        { find: /^react-router$/, replacement: `${here}react-router-stub.ts` },
        { find: /^@tanstack\/react-query$/, replacement: `${here}react-query-stub.ts` },
        { find: "@wonderful/app-sdk", replacement: `${app}/runner/sdk-shim.ts` },
      ],
    },
    optimizeDeps: { exclude: ["react-router", "@tanstack/react-query"] },
  };
});
