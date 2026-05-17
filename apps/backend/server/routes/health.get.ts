export default defineEventHandler(() => {
  return {
    ok: true,
    service: "touchx-backend",
    mode: "api-v1-native",
    nexus: "/nexus",
    runtime: process.env.NITRO_PRESET === "node-server" || process.env.PORT ? "node-server" : "cloudflare-worker",
    timestamp: new Date().toISOString(),
  };
});
