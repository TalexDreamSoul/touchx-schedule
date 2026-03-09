# @touchx/backend

Nuxt 3 + Nitro + Cloudflare Worker，一体承载 **API + ScheduleNexus 管理页面**。

## 路由

- API：`/api/v1/*`
- 管理中台：`/nexus`
- 兼容入口：`/admin`（302 到 `/nexus`）
- 健康检查：`/health`

## 关键能力（本期）

- 学号身份体系、管理员 RBAC（`super_admin`/`operator`）。
- ScheduleNexus 全模块可视化编辑（用户、班级、课表、食物、竞选、媒体、机器人、预览、审计）。
- 班级创建与加入码轮换、班级成员管理。
- 课表发布版本、订阅跟随、个人补丁、冲突处理。
- 食物价格曲线预览与历史回放。
- 匿名投票活动与实名揭示规则（截止后分享码可见）。
- 位置网格化存储 + 直线距离计算（Haversine）。
- 机器人建议引擎与次日播报任务。
- 媒体资产审计、引用对账与孤儿清理。
- 启动时优先从 legacy 归一化数据导入（`users.normalized` / `courses.normalized`），避免使用演示假数据。

## 旧数据导入（当前实现）

- 导入源：`/apps/backend/server/data/legacy/users.normalized.json`
- 导入源：`/apps/backend/server/data/legacy/courses.normalized.json`
- 导入行为：`domain-store` 启动时自动构建用户、班级、班级成员、课表版本与订阅基线。
- 重置行为：调用 `POST /api/v1/dev/reset-store` 会重新按上述 legacy 数据重建内存态。

## 环境变量

- `NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO`：首次初始化管理员学号（默认 `2305100613`）。
- `NEXUS_ADMIN_LOGIN_PASSWORD`：ScheduleNexus 管理页登录密码。留空时启用首次免密初始化流程。
- `NEXUS_SESSION_TOKEN_SECRET`：会话签名密钥（强烈建议配置；用于跨实例校验登录态，避免刷新掉线）。
- `NEXUS_HEARTBEAT_TOKEN`：心跳接口令牌（用于 Cron/外部任务无登录态触发）。
- `NEXUS_HEARTBEAT_TIMEZONE`：心跳时区（默认 `Asia/Shanghai`）。
- `NEXUS_DEV_HOST`：本地 dev host（默认 `0.0.0.0`）。
- `NEXUS_DEV_PORT`：本地 dev/preview 端口（默认 `9986`）。

本地 Nuxt 开发请使用 `.env`：

```bash
cp .env.example .env
```

如果你使用 `wrangler dev`，再额外配置 `.dev.vars`：

```bash
cp .dev.vars.example .dev.vars
```

## 鉴权行为

- 访问 `/nexus/*` 未登录时会自动跳转到 `/nexus/login?redirect=...`。
- 登录成功后自动回跳到原目标页面。
- 服务端采用签名 token 校验会话（`txs1`），不依赖内存 session 验证。

## Heartbeat 与提醒

- 接口：`POST /api/v1/bot/jobs/heartbeat`
- 推荐用途：每 15 分钟触发一次“心跳判定”，由后端决定是否执行提醒任务。
- 时间窗保护：默认只在 `08:00-23:59` 执行；窗外返回 `skipped=true`。
- 幂等：同一个 15 分钟桶只会生效一次，重复调用会返回 `DUPLICATE_BUCKET`。
- 21:00 桶会自动触发“次日建议生成”。

鉴权方式二选一：

1) `x-heartbeat-token`（推荐给 Cron）  
2) 管理员 Bearer token（用于手工调试）

示例（Cron/脚本）：

```bash
curl -X POST "https://schedule-backend.tagzxia.com/api/v1/bot/jobs/heartbeat" \
  -H "x-heartbeat-token: $NEXUS_HEARTBEAT_TOKEN" \
  -H "content-type: application/json" \
  -d '{}'
```

强制执行/演练：

```bash
curl -X POST "https://schedule-backend.tagzxia.com/api/v1/bot/jobs/heartbeat" \
  -H "x-heartbeat-token: $NEXUS_HEARTBEAT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"force":true,"dryRun":true}'
```

Cloudflare Cron 示例表达式（Cloudflare 按 UTC 解释；对应北京时间每 15 分钟，8 点到 23 点）：

```txt
*/15 0-15 * * *
```

## 本地开发

```bash
pnpm --filter @touchx/backend dev
```

## 类型检查与构建

```bash
pnpm --filter @touchx/backend type-check
pnpm --filter @touchx/backend build
```

## 运行时自检（防回归）

启动本地服务后执行：

```bash
pnpm --filter @touchx/backend smoke:local
```

可通过 `SMOKE_BASE_URL` 覆盖目标地址（默认 `http://127.0.0.1:9986`）。

## Cloudflare 部署

先确认 Cloudflare 登录：

```bash
pnpm --filter @touchx/backend exec wrangler whoami
```

部署：

```bash
pnpm --filter @touchx/backend deploy
```

默认会发布并绑定自定义域名：`schedule-backend.tagzxia.com`。

生产变量建议使用 Cloudflare Secrets（不要写入 `wrangler.toml`）：

```bash
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_ADMIN_LOGIN_PASSWORD
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_SESSION_TOKEN_SECRET
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_HEARTBEAT_TOKEN
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_HEARTBEAT_TIMEZONE
```

## GitHub 自动部署

已提供工作流：`/.github/workflows/deploy-backend-cloudflare.yml`。

需要在 GitHub 仓库设置以下 Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
