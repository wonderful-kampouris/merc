// Optional runner for just the WP-APP-07 render tests (they are also in the default `vitest run`; ui-base is stubbed via vi.mock in each file): `npx vitest run -c ../../evidence/WP-APP-07/tools/vitest.render.config.ts` from app/app.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const app = fileURLToPath(new URL("../../../app/app", import.meta.url));
const stub = fileURLToPath(new URL("./react-router-stub.ts", import.meta.url));

export default defineConfig({
  root: app,
  resolve: {
    alias: [
      { find: /^react-router$/, replacement: stub },
      { find: /^@tanstack\/react-query$/, replacement: fileURLToPath(new URL("./react-query-stub.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["src/screens/management/{campaigns,territories,settings,users,import,gdpr,ai_log}/render.test.ts"],
    environment: "node",
    server: { deps: { inline: [/@wonderful\/ui-base/] } },
  },
});
