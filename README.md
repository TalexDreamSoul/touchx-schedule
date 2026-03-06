# TouchX Monorepo

## 目录结构

```text
apps/
  admin-web/        # Vue3 管理端
  microapp/         # uni-app 小程序端
backends/
  backend/          # Nuxt + Cloudflare Worker 网关后端
  legacy-fastapi/   # 旧 FastAPI 后端（迁移过渡）
packages/
  shared/           # 跨端共享类型与常量
```

## 快速启动

先安装依赖：

```bash
pnpm install
```

启动管理端：

```bash
pnpm dev:admin
```

启动 Nuxt 网关后端（Cloudflare 运行模型）：

```bash
pnpm dev:backend
```

启动旧 FastAPI（迁移过渡期）：

```bash
pnpm dev:legacy
```

启动小程序开发：

```bash
pnpm dev:microapp
```

## 构建命令

```bash
pnpm build:admin
pnpm build:admin:legacy
pnpm build:backend
pnpm build:microapp
```

- `build:admin`：输出 `apps/admin-web/dist`（适合独立部署）
- `build:admin:legacy`：输出 `backends/legacy-fastapi/admin_dist`（给 legacy-fastapi 托管）

## Cloudflare 部署（Nuxt 后端）

认证：

```bash
pnpm --filter @touchx/backend exec wrangler whoami
```

部署：

```bash
pnpm deploy:backend
```

## 当前迁移策略

- `/api/*` 先由 `backend` 代理到 `legacy-fastapi`，保证接口连续可用。
- 新功能优先落到 `backend`，旧能力逐步从 `legacy-fastapi` 收敛迁移。
