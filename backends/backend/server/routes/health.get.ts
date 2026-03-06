export default defineEventHandler(() => {
  return {
    ok: true,
    service: "touchx-backend",
    runtime: "cloudflare-worker",
    timestamp: new Date().toISOString(),
  };
});
