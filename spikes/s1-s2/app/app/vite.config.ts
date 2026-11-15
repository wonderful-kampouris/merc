import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import svgr from "vite-plugin-svgr";
import { createSourceAnchorPlugins } from "./infra/source-anchor-plugin";
import { createLayoutGuardPlugin } from "./infra/layout-guard-plugin";
import { createBrowserSafetyGuardPlugin } from "./infra/browser-safety-guard-plugin";

// @vitejs/plugin-react v6 transforms JSX with oxc and no longer accepts a
// `babel` option, so the source-anchor Babel plugin can't ride along with it
// anymore. Instead we run that plugin as a standalone `enforce: "pre"`
// transform: Babel parses the TSX, the anchor visitor injects its spreads, and
// the generator emits TSX again (no JSX/TS transform runs here) — plugin-react
// then handles the actual JSX/TS lowering downstream.
// biome-ignore lint/suspicious/noExplicitAny: Babel plugin factory is untyped.
function sourceAnchorBabelPlugin(anchorBabel: any): Plugin {
  return {
    name: "wonderful-source-anchor-babel",
    enforce: "pre",
    async transform(code, id) {
      const [file] = id.split("?");
      if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) {
        return null;
      }
      const result = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        // Parse TS + JSX but run no transform preset, so the output keeps its
        // JSX/TS syntax intact for plugin-react/oxc to lower afterwards.
        parserOpts: { plugins: ["jsx", "typescript"] },
        plugins: [anchorBabel],
      });
      if (!result?.code) {
        return null;
      }
      return { code: result.code, map: result.map };
    },
  };
}

const runnerSdkShimPath = fileURLToPath(
  new URL("./runner/sdk-shim.ts", import.meta.url),
);

// Dependencies the platform host provides at render time. Externalized so the
// bundle stays small and shares the host's SINGLE live instance — never bundled
// into the app.
//
// `@wonderful/ui-base` is BUNDLED, deliberately — it is NOT in this list.
//
// It used to be external: the 0.100.0 artifact was one monolithic
// `ui-base.es.js`, so bundling dragged the whole library into every app and blew
// the agent app build up with out-of-memory. 3.x publishes per module (378
// component modules), so the bundle is tree-shaken down to what the app actually
// imports — a few components cost a few components, and `recharts`/`three`/
// `framer-motion` never enter the graph unless something uses them.
//
// Bundling is what decouples an app from the host's served chunk: that chunk is
// pinned to the frozen antd-era 0.100.0 for already-deployed apps, so an app
// resolving the bare specifier can only ever see `Box`/`Stack`/`PageLayout`.
// Compiling its own copy is how a new app gets `Page`, the `Layout` family and
// the current `Card`.
//
// Because it is bundled, the app also owns its CSS: `src/style.css` imports
// `@wonderful/ui-base/embedded.css` (the cascade-layered build, so the host's
// styles still win). Component modules carry no side-effectful CSS imports, so
// without that import the app would render completely unstyled.
//
// React/ReactDOM/jsx-runtime stay external so the bundle shares the host's one
// React instance (two Reacts = broken hooks), and `@wonderful/app-sdk` stays
// external because it is the host<->app bridge and must be the host's instance.
const external = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "@wonderful/app-sdk",
  "@wonderful/genui-react",
  // Platform-shared packages — uncomment when you install them so your bundle
  // uses the host's copy instead of shipping its own.
  // See the "URL state" guide in the Wonderful Apps docs.
  // "react-router-dom",
  // "use-query-params",
];

// CommonJS-only packages that `require("react")`. React is external, so the
// bundler can only keep that as a runtime `require`, and the browser has none:
// the app fails to load. ui-base pulls `use-sync-external-store` in through
// react-aria and recharts; these aliases swap in the ESM copies under `infra/`.
const useSyncExternalStoreAliases = [
  {
    find: /^use-sync-external-store(\/shim)?\/with-selector(\.js)?$/,
    replacement: fileURLToPath(new URL("./infra/use-sync-external-store/with-selector.ts", import.meta.url)),
  },
  {
    find: /^use-sync-external-store(\/shim)?(\/index\.js)?$/,
    replacement: fileURLToPath(new URL("./infra/use-sync-external-store/shim.ts", import.meta.url)),
  },
];

// Deployed Wonderful Apps must parse on the same oldest Android Chromium
// version supported by the platform host. Runtime API gaps are polyfilled by
// the host before app modules load.
const platformBrowserTarget = "chrome91";

// The shippable app bundle contract, shared by the production build and the
// design build (they differ only in output dir + the source-anchor plugin).
// Return type pins the object to Vite's BuildOptions so `formats: ["es"]` is
// contextually typed as LibraryFormats[] (no `as const`, which would make it
// readonly and break the LibraryOptions assignment).
function libBuild(outDir: string): UserConfig["build"] {
  return {
    target: platformBrowserTarget,
    outDir,
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "app",
    },
    rollupOptions: { external },
    cssCodeSplit: false,
  };
}

export default defineConfig(({ command, mode }) => {
  if (mode === "runner") {
    return {
      plugins: [svgr({ include: ["**/*.svg", "**/*.svg?react"] }), react()],
      root: "runner",
      server: {
        fs: {
          allow: [".."],
        },
      },
      resolve: {
        alias: {
          "@wonderful/app-sdk": runnerSdkShimPath,
        },
      },
      build: {
        outDir: "../runner-dist",
        emptyOutDir: true,
      },
    };
  }

  if (command === "serve") {
    return {
      plugins: [svgr({ include: ["**/*.svg", "**/*.svg?react"] }), react()],
      root: "dev",
      resolve: {
        alias: {
          "@wonderful/app-sdk": runnerSdkShimPath,
        },
      },
    };
  }

  // Production build. We stamp every host element with an OPAQUE `data-wf-id`
  // and emit a private `wf-source-map.json` sidecar (id → file/line/component).
  // The ids are meaningless without the sidecar, which is never served to
  // deployed clients — the assistant page fetches it and injects `data-source-*`
  // itself. So design-mode anchoring needs no separate bundle.
  const anchor = createSourceAnchorPlugins();
  return {
    plugins: [
      createLayoutGuardPlugin(),
      sourceAnchorBabelPlugin(anchor.babel),
      svgr({ include: ["**/*.svg", "**/*.svg?react"] }),
      react(),
      anchor.vite,
      createBrowserSafetyGuardPlugin(),
    ],
    root: ".",
    resolve: { alias: useSyncExternalStoreAliases },
    // ui-base ships `process.env.NODE_ENV` dev guards, and a Vite *library*
    // build does not replace them the way an app build does — so without this
    // the shipped bundle references `process`, which the browser does not have,
    // and the app dies on load with "process is not defined". Pin it for the
    // production bundle (dev and the runner keep Vite's own handling).
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.env": "{}",
    },
    build: libBuild("dist"),
  };
});
