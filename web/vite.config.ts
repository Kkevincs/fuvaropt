import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin in dev so the browser does not hit CORS. Route-plans API on 1010.
      "/route-plans": {
        target: "http://localhost:1010",
        changeOrigin: true,
      },
      "/schedules": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      /**
       * Planning API on 8081: browser calls same-origin `/schedule-solver/...` (no CORS);
       * forwarded to e.g. `http://localhost:8081/schedules/problem`.
       */
      "/schedule-solver": {
        target: "http://localhost:8081",
        changeOrigin: true,
        /** Multi-day solve can run a long time; default proxy timeout may return an empty 200. */
        timeout: 1_200_000,
        proxyTimeout: 1_200_000,
        rewrite: (path) => path.replace(/^\/schedule-solver/, ""),
      },
    },
  },
  preview: {
    proxy: {
      "/route-plans": {
        target: "http://localhost:1010",
        changeOrigin: true,
      },
      "/schedules": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/schedule-solver": {
        target: "http://localhost:8081",
        changeOrigin: true,
        /** Multi-day solve can run a long time; default proxy timeout may return an empty 200. */
        timeout: 1_200_000,
        proxyTimeout: 1_200_000,
        rewrite: (path) => path.replace(/^\/schedule-solver/, ""),
      },
    },
  },
});
