export default defineEventHandler(() => {
  return {
    ok: true,
    service: "touchx-backend",
    mode: "api-v1-native",
    nexus: "/nexus",
    runtime: "cloudflare-worker",
    timestamp: new Date().toISOString(),
  };
});
