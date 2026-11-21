import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || "0.0.0"),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "localhost",
    port: 5173,
    // `dist` is build output; watching it makes the dev server crash with
    // EBUSY on Windows whenever an antivirus/indexer locks a built file.
    watch: { ignored: ["**/dist/**", "**/server/uploads/**"] },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
