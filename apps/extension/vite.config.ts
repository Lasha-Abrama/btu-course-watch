import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
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
});
