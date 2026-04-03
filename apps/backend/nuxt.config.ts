export default defineNuxtConfig({
  compatibilityDate: "2026-03-06",
  dir: {
    pages: "app/pages",
    middleware: "app/middleware",
  },
  modules: ["@nuxtjs/tailwindcss"],
  css: ["~/app/assets/css/tailwind.css"],
  vite: {
    build: {
      cssCodeSplit: false,
    },
  },
  routeRules: {
    "/": {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
    "/nexus/**": {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
    "/admin/**": {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
    "/_nuxt/**": {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
      },
    },
  },
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
    adminLoginPassword: process.env.NEXUS_ADMIN_LOGIN_PASSWORD || "",
    adminBootstrapStudentNo: process.env.NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO || "2305100613",
    sessionTokenSecret: process.env.NEXUS_SESSION_TOKEN_SECRET || "",
    heartbeatToken: process.env.NEXUS_HEARTBEAT_TOKEN || "",
    heartbeatTimezone: process.env.NEXUS_HEARTBEAT_TIMEZONE || "Asia/Shanghai",
    botDeliveryToken: process.env.NEXUS_BOT_DELIVERY_TOKEN || "",
    public: {
      appName: "TouchX Backend + ScheduleNexus",
      apiProxyMode: "native-v1",
      apiBase: "/api/v1",
      nexusPath: "/nexus",
    },
  },
});
