import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin in dev so the browser does not hit CORS (8080 has no ACAO).
      "/route-plans": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      "/route-plans": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
