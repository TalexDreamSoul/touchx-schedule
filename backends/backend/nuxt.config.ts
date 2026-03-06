export default defineNuxtConfig({
  compatibilityDate: "2026-03-06",
  devtools: {
    enabled: false,
  },
  nitro: {
    preset: "cloudflare_module",
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  runtimeConfig: {
    legacyApiBase: process.env.LEGACY_API_BASE || "http://127.0.0.1:9986",
    adminWebOrigin: process.env.ADMIN_WEB_ORIGIN || "",
    public: {
      appName: "TouchX Backend Gateway",
      apiProxyMode: "legacy-fastapi",
    },
  },
});
