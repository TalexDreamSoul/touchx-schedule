# TouchX Monorepo

## 目录结构

```text
apps/
  backend/          # Nuxt + Cloudflare Worker（API + 内置后台页面）
  microapp/         # 旧 uni-app 小程序端（迁移期保留）
  miniapp/          # Taro + React 小程序新路线
  mobile/           # React Native CLI App 骨架
packages/
  shared/           # 跨端共享类型与常量
  calendar-core/    # 日程合成、覆盖、冲突、提醒候选等纯 TS 核心
  api-client/       # 跨端 API SDK
  notification-core/# 通知模型与投递状态纯函数
  ui-tokens/        # shadcn/ui 风格 token、iOS Liquid Glass / Android token
```

> 独立 `apps/cms` 已移除。生产和 MVP 后台统一收敛到 `apps/backend` 内置 Nuxt 页面；后续 UI 按 shadcn 简约风格迭代。

## 快速启动

先安装依赖：

```bash
pnpm install
```

启动 Nuxt 网关后端（Cloudflare 运行模型 + 后台页面）：

```bash
pnpm dev:backend
```

启动旧 uni-app 小程序开发：

```bash
pnpm dev:microapp
```

启动新 Taro React 小程序开发：

```bash
pnpm dev:miniapp
```

启动 React Native Metro：

```bash
pnpm dev:mobile
```

## 构建命令

```bash
pnpm build:backend
pnpm build:microapp
pnpm build:miniapp
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

路由边界：`/api/**` 只放接口 / JSON / webhook；非 `/api` 路径都是页面。

- 后台首页：`/`（未登录或登录态失效跳 `/nexus/login`）
- API 基线：`/api/v1/*`
- API 健康检查：`/api/health`（兼容保留 `/health`）
- ClawDBot webhook：`POST /api/v1/bot/clawdbot/webhook`，需 `x-clawdbot-webhook-token`（或兼容 `x-bot-delivery-token`）匹配环境变量 `TOUCHX_CLAWDBOT_WEBHOOK_TOKEN` / `NEXUS_BOT_DELIVERY_TOKEN`。
- 新 Calendar API：`/api/v1/calendar/*`
- 管理中台兼容路径：`/nexus`；旧 `/nexus/[module]` 仅作为模块别名重定向到新页面。
- 后台页面：`/`、`/nexus/users`、`/nexus/classes`、`/nexus/calendar-sources`、`/nexus/schedules`、`/nexus/personal-events`、`/nexus/imports`、`/nexus/schedule-import`、`/nexus/foods`、`/nexus/media`、`/nexus/bots`、`/nexus/campaigns`、`/nexus/heart-open-word-bank`、`/nexus/reminder-rules`、`/nexus/reminder-candidates`、`/nexus/notification-channels`、`/nexus/notification-deliveries`、`/nexus/preview`、`/nexus/audit-logs`、`/nexus/settings`
- 兼容页面别名：`/admin`（302 到 `/nexus`）
- 默认本地后台管理员：`admin@schedule.com` / `123456`

## 产品与架构 Roadmap

TouchX 后续将从“课表系统”升级为“通用可订阅日程平台”：支持通用日程源、个人覆盖、Todo、PDF / 教务系统导入、微信 ClawDBot + 飞书双渠道提醒、React Native App，以及 Docker 服务器部署。

详细规划见：[`docs/touchx-calendar-platform-roadmap.md`](docs/touchx-calendar-platform-roadmap.md)
