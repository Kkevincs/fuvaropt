/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** POST route plan job URL. Default `/route-plans` (Vite proxies to 8080 in dev/preview). */
  readonly VITE_ROUTE_PLANS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
