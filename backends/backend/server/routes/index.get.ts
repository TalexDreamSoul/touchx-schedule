export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  return {
    ok: true,
    service: config.public.appName,
    mode: config.public.apiProxyMode,
    docs: {
      health: "/health",
      api: "/api/* (代理到 legacy-fastapi)",
      admin: "/admin/* (可选跳转到管理前端域名)",
    },
  };
});
