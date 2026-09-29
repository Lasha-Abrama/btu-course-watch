import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDirectory, "BCW_");
  const local = mode === "development" || mode === "test";
  const apiOrigin =
    env.BCW_API_ORIGIN || (local ? "http://localhost:3001" : "");
  const webOrigin =
    env.BCW_WEB_ORIGIN || (local ? "http://localhost:3000" : "");
  for (const origin of [apiOrigin, webOrigin]) {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== "https:" &&
        !(
          local &&
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname)
        ))
    ) {
      throw new Error(
        "BCW origins must be exact HTTPS origins outside local development.",
      );
    }
  }
  return {
    define: {
      __BCW_API_ORIGIN__: JSON.stringify(apiOrigin),
      __BCW_WEB_ORIGIN__: JSON.stringify(webOrigin),
    },
    plugins: [
      {
        name: "extension-manifest",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify({
              manifest_version: 3,
              name: "BTU Course Watch",
              description: "The browser companion for BTU Course Watch.",
              version: "0.1.0",
              permissions: ["storage"],
              host_permissions: [
                "https://classroom.btu.edu.ge/*",
                `${apiOrigin}/*`,
              ],
              action: {
                default_popup: "popup.html",
                default_title: "BTU Course Watch",
              },
              background: { service_worker: "background.js", type: "module" },
            }),
          });
        },
      },
    ],
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: resolve(rootDirectory, "src/background.ts"),
          popup: resolve(rootDirectory, "popup.html"),
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  };
});
