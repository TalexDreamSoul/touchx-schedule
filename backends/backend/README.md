# @touchx/backend

Nuxt 3 + Nitro Cloudflare Worker 后端网关。

## 目标

- 对外提供统一入口（`/health`、`/api/*`、`/admin/*`）。
- 在迁移期将 `/api/*` 代理到 `legacy-fastapi`，保持现有业务接口可用。
- 后续逐步把 `legacy-fastapi` 业务拆到 Nuxt server routes。

## 环境变量

- `LEGACY_API_BASE`：legacy FastAPI 地址（示例：`http://127.0.0.1:9986`）
- `ADMIN_WEB_ORIGIN`：管理端域名（示例：`https://admin.touchx.example.com`）

本地可复制 `.dev.vars.example` 为 `.dev.vars`。

## 开发

```bash
pnpm --filter @touchx/backend dev
```

## 构建

```bash
pnpm --filter @touchx/backend build
```

## 部署 Cloudflare Worker

先确认 Cloudflare 登录：

```bash
pnpm --filter @touchx/backend exec wrangler whoami
```

部署：

```bash
pnpm --filter @touchx/backend deploy
```
