export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  return {
    ok: true,
    service: config.public.appName,
    mode: config.public.apiProxyMode,
    docs: {
      health: "/health",
      api: "/api/v1/*",
      nexus: "/nexus",
      adminAlias: "/admin -> /nexus",
    },
  };
});
