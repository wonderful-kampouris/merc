// Screenshot harness for WP-APP-05 (mock mode). Same as app/app's dev server, plus a react-router stub.
// Run: cd app/app && npx vite --config ../../evidence/WP-APP-05/harness/vite.screens.config.mjs --port 5189
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const app = fileURLToPath(new URL("../../../app/app/", import.meta.url));
const req = createRequire(`${app}package.json`);
const load = async (name) => (await import(pathToFileURL(req.resolve(name)).href)).default;

export default async () => {
  const react = await load("@vitejs/plugin-react");
  return {
    plugins: [react()],
    root: here,
    server: { fs: { allow: [app, here] } },
    resolve: {
      alias: {
        "@wonderful/app-sdk": `${app}runner/sdk-shim.ts`,
        "react-router": `${here}react-router-stub.js`,
        "@tanstack/react-query": `${here}react-query-stub.js`,
      },
    },
    optimizeDeps: { entries: [`${here}index.html`] },
  };
};
