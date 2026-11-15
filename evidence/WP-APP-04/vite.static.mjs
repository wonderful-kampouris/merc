// Static production-style build of the dev entry (dev/main.tsx) for WP-APP-04 screenshots.
// Same tree-shaking as `pnpm build`, so ui-base's optional deps (react-router, react-query) drop out.
const APP = "/Users/stefanos.k/Documents/genai/app/app";
const react = (await import(`${APP}/node_modules/@vitejs/plugin-react/dist/index.js`)).default;
export default {
  configFile: false,
  plugins: [react()],
  root: `${APP}/dev`,
  base: "./",
  resolve: { alias: { "@wonderful/app-sdk": `${APP}/runner/sdk-shim.ts` } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: "/tmp/wp04shot/dist", emptyOutDir: true, minify: false },
};
