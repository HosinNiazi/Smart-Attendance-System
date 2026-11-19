import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
