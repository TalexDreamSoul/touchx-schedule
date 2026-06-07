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

V1 本地收口 gate：

```bash
pnpm --filter @touchx/backend verify:v1-local
```

该 gate 会同时跑 backend type-check、后端 node tests、`pnpm test:packages` workspace 包测试、miniapp / mobile type-check，以及 `smoke:api-boundaries`、`smoke:admin-ui-boundaries`、`smoke:client-boundaries`、`smoke:miniapp-parity`、`smoke:data-boundaries` 和 `smoke:cloudflare-config`。这些检查会防止 `/api/v1` 入口重新回到大 handler，防止后台页面绕过共享 Nexus shell 或回流旧 `NexusConsole`，防止 miniapp/mobile 重新复制 API wrapper 或端侧 schedule/theme token，防止 miniapp profile / 通知绑定 / PDF 导入 / 自定义日程源发布退回非真实 API 闭环，也防止 V1 收口阶段提前引入 PostgreSQL / Redis / Docker Compose。

V1 发版前本地 gate（包含小程序构建）：

```bash
pnpm verify:v1-release
```

该 gate 会先跑 `@touchx/backend` 的 `verify:v1-local`，再跑 `@touchx/miniapp build:weapp`，用于发版前确认 Taro 小程序当前主线路线仍可构建。

V1 当前收口功能、剩余生产验收项和建议提交批次见 `docs/v1-closeout-status.md`。

Cloudflare 生产资源只读复核（需要已登录 Wrangler，不会写资源）：

```bash
pnpm --filter @touchx/backend smoke:cloudflare-live
```

V1 生产验收聚合 gate（需要真实生产 token、真实学生学号、ClawDBot webhook token、ClawDBot + 飞书双通知通道和真实 PDF 样本）：

```bash
pnpm --filter @touchx/backend verify:v1-production
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
- 通知绑定：后台 `/nexus/notification-channels` 可维护用户级飞书 / ClawDBot 绑定；飞书企业应用发送时优先使用用户绑定的 open_id / user_id / union_id，未绑定再回退 `defaultReceiveId`。
- 提醒投递迁移：默认使用通用 `notificationDeliveries`，heartbeat 与机器人 pending/ack 均走统一通知投递记录；仅显式设置 `NEXUS_REMINDER_DELIVERY_QUEUE=legacy` 时回退旧 D1 `schedule_reminder_deliveries`。
- 跨端 API：`apps/miniapp` 与 `apps/mobile` 都通过 `@touchx/api-client` 调用核心 API；端侧只保留 Taro 上传、Taro storage、React Native Settings 和 `TOUCHX_API_BASE_URL` / `TARO_APP_TOUCHX_API_BASE_URL` 环境覆盖等平台适配。
- 新 Calendar API：`/api/v1/calendar/*`
- 管理中台兼容路径：`/nexus`；旧 `/nexus/[module]` 仅作为模块别名重定向到新页面。
- 后台页面：`/`、`/nexus/users`、`/nexus/classes`、`/nexus/calendar-sources`、`/nexus/schedules`、`/nexus/personal-events`、`/nexus/imports`、`/nexus/schedule-import`、`/nexus/foods`、`/nexus/media`、`/nexus/bots`、`/nexus/campaigns`、`/nexus/heart-open-word-bank`、`/nexus/reminder-rules`、`/nexus/reminder-candidates`、`/nexus/notification-channels`、`/nexus/notification-deliveries`、`/nexus/preview`、`/nexus/audit-logs`、`/nexus/settings`
- 兼容页面别名：`/admin`（302 到 `/nexus`）
- 默认本地后台管理员：`admin@schedule.com` / `123456`

## 产品与架构 Roadmap

TouchX 后续将从“课表系统”升级为“通用可订阅日程平台”：支持通用日程源、个人覆盖、Todo、PDF / 教务系统导入、微信 ClawDBot + 飞书双渠道提醒、React Native App，以及 Docker 服务器部署。

详细规划见：[`docs/touchx-calendar-platform-roadmap.md`](docs/touchx-calendar-platform-roadmap.md)

小程序路线决策见：[`docs/miniapp-route-decision.md`](docs/miniapp-route-decision.md)
