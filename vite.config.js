import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

// face-api loads model manifests and `.bin` weight files with fetch(). Some
// browsers/download managers treat an `application/octet-stream` response
// without `Content-Disposition` as a download, so the headers are made
// explicit during dev and preview. Production hosts need the same headers
// (see public/_headers).
function modelHeaderPlugin() {
  const apply = (req, res) => {
    const pathname = String(req.url || "").split("?")[0];
    if (!/\/models\/[^/]+\.(bin|json)$/i.test(pathname)) return;
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (/\.bin$/i.test(pathname)) {
      res.setHeader("Content-Type", "application/octet-stream");
    }
  };
  const install = (server) => {
    server.middlewares.use((req, res, next) => {
      apply(req, res);
      next();
    });
  };
  return {
    name: "models-inline-headers",
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default defineConfig({
  plugins: [react(), modelHeaderPlugin()],
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
