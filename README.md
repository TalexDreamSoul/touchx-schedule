# TouchX Monorepo

## 目录结构

```text
apps/
  backend/          # Nuxt + Cloudflare Worker（API + ScheduleNexus，一体化）
  microapp/         # uni-app 小程序端
packages/
  shared/           # 跨端共享类型与常量
```

## 快速启动

先安装依赖：

```bash
pnpm install
```

启动 Nuxt 网关后端（Cloudflare 运行模型）：

```bash
pnpm dev:backend
```

启动小程序开发：

```bash
pnpm dev:microapp
```

## 构建命令

```bash
pnpm build:backend
pnpm build:microapp
```

## Cloudflare 部署（Nuxt 后端）

`wrangler.toml` 位于 `apps/backend/wrangler.toml`（按 workspace 隔离，不放根目录）。
GitHub 自动部署工作流位于 `/.github/workflows/deploy-backend-cloudflare.yml`。

认证：

```bash
pnpm --filter @touchx/backend exec wrangler whoami
```

部署：

```bash
pnpm deploy:backend
```

## 当前后端入口

- API 基线：`/api/v1/*`
- 管理中台（ScheduleNexus）：`/nexus`
- 兼容别名：`/admin`（302 到 `/nexus`）
- 健康检查：`/health`
