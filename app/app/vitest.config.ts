import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (library/runner build) so unit tests run in plain node.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
