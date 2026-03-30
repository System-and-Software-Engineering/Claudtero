import "dotenv/config";
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

const appEnv = process.env.APP_ENV === "dev" ? "dev" : "prod";
const runtimeEnv = appEnv === "dev" ? "development" : "production";
const dist = `.scaffold/build/${appEnv}`;
const addonName =
  appEnv === "dev" ? `${pkg.config.addonName} (Dev)` : pkg.config.addonName;

export default defineConfig({
  source: ["src", "addon"],
  dist,
  name: addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      addonName,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: JSON.stringify(runtimeEnv),
          __appEnv__: JSON.stringify(appEnv),

          // Inject dev keys
          // TODO: Remove later
          __OPENAI_API_KEY__: JSON.stringify(process.env.OPENAI_API_KEY ?? ""),
          __OPENROUTER_API_KEY__: JSON.stringify(process.env.OPENROUTER_API_KEY ?? ""),
        },
        bundle: true,
        target: "firefox115",
        outfile: `${dist}/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  server: {
    devtools: appEnv === "dev",
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
