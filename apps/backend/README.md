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
- 统一提醒引擎：次日摘要、课前提醒、去重入队、机器人拉取/回执。
- 媒体资产审计、引用对账与孤儿清理。
- 启动时优先从 legacy 归一化数据导入（`users.normalized` / `courses.normalized`），避免使用演示假数据。

## 旧数据导入（当前实现）

- 导入源：`/apps/backend/server/data/legacy/users.normalized.json`
- 导入源：`/apps/backend/server/data/legacy/courses.normalized.json`
- 导入行为：`domain-store` 启动时自动构建用户、班级、班级成员、课表版本与订阅基线。
- 重置行为：调用 `POST /api/v1/dev/reset-store` 会重新按上述 legacy 数据重建内存态。

## 环境变量

- `NEXUS_DB`：Cloudflare D1 绑定（用于后端全量状态持久化）。
- `SCHEDULE_IMPORT_BUCKET`：课表 PDF 临时存储的 R2 绑定（异步导入队列使用）。
- `SCHEDULE_IMPORT_QUEUE`：课表导入异步队列绑定（producer + consumer）。
- `NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO`：首次初始化管理员学号（默认 `2305100613`）。
- `NEXUS_ADMIN_LOGIN_PASSWORD`：ScheduleNexus 管理页登录密码。留空时启用首次免密初始化流程。
- `NEXUS_SESSION_TOKEN_SECRET`：会话签名密钥（强烈建议配置；用于跨实例校验登录态，避免刷新掉线）。
- `NEXUS_HEARTBEAT_TOKEN`：心跳接口令牌（用于 Cron/外部任务无登录态触发）。
- `NEXUS_HEARTBEAT_TIMEZONE`：心跳时区（默认 `Asia/Shanghai`）。
- `NEXUS_BOT_DELIVERY_TOKEN`：机器人投递接口令牌（用于企业微信机器人拉取待发送消息并回执）。
- `NEXUS_REMINDER_DELIVERY_QUEUE`：提醒投递队列模式。默认 `notification`，heartbeat 与机器人 pending/ack 走通用 `notificationDeliveries`；仅设为 `legacy` 时回退旧 D1 `schedule_reminder_deliveries`。
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

## Heartbeat、提醒与机器人投递

- 接口：`POST /api/v1/bot/jobs/heartbeat`
- 推荐用途：每 15 分钟触发一次“心跳判定”，由后端决定是否执行提醒任务。
- 时间窗保护：默认只在 `08:00-23:59` 执行；窗外返回 `skipped=true`。
- 幂等：同一个 15 分钟桶只会生效一次，重复调用会返回 `DUPLICATE_BUCKET`。
- 21:00 桶会自动触发“次日摘要”。
- 当前统一产出两类提醒：
  - `next_day_digest`
  - `pre_class_reminder`
- 默认情况下，heartbeat 会把提醒写入通用 `notificationDeliveries`，并带 `payload.sourceQueue=notification`；机器人 `pending/ack` 会从通用队列拉取和回执，后台 `/nexus/notification-deliveries` 可按来源筛选这些记录。
- 当 `NEXUS_REMINDER_DELIVERY_QUEUE=legacy` 时，提醒会回退进入 D1 `schedule_reminder_deliveries` 待发送表，保留旧 `dedupeKey`、`dueAt`、接收人、模板与 payload 兼容路径。
- Cloudflare Worker 已挂 `scheduled` 钩子，`wrangler.toml` 中的 cron 会直接触发同一套 heartbeat 逻辑；`/api/v1/bot/jobs/heartbeat` 保留为调试入口。

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

机器人投递接口（外部企业微信机器人使用）：

- `GET /api/v1/bot/deliveries/pending?limit=20`
- `POST /api/v1/bot/deliveries/:id/ack`
- 鉴权头：`x-bot-delivery-token: $NEXUS_BOT_DELIVERY_TOKEN`

回执示例：

```bash
curl -X POST "https://schedule-backend.tagzxia.com/api/v1/bot/deliveries/delivery_xxx/ack" \
  -H "x-bot-delivery-token: $NEXUS_BOT_DELIVERY_TOKEN" \
  -H "content-type: application/json" \
  -d '{"success":true,"externalMessageId":"wx-msg-id"}'
```

## 服务端时间校准

- `GET /api/v1/today-brief`
  - 返回 `serverNowIso`、`serverTimezone`、`termMeta`、`currentWeek`
- `GET /api/v1/schedules/student`
  - 返回 `serverNowIso`、`serverTimezone`、`termMeta`
  - 当显式传入 `studentId` 时，必须命中对应用户；未命中会返回 `404 SCHEDULE_TARGET_NOT_FOUND`
- 小程序应维护 `serverOffsetMs`，所有“当前周次 / 当前课程 / 倒计时 / 出发提醒”统一基于服务端时间偏移，不直接信任设备本地时钟。

## 本地开发

```bash
pnpm --filter @touchx/backend dev
```

如果需要强制清理 Nuxt/Vite 缓存后再启动，可显式开启：

```bash
NEXUS_DEV_CLEAR=1 pnpm --filter @touchx/backend dev
```

## 类型检查与构建

```bash
pnpm --filter @touchx/backend type-check
pnpm --filter @touchx/backend build
```

V1 本地收口 gate：

```bash
pnpm --filter @touchx/backend verify:v1-local
```

该 gate 包含 backend type-check、后端 node tests、`pnpm test:packages` workspace 包测试、miniapp / mobile type-check、`smoke:api-boundaries`、`smoke:admin-ui-boundaries`、`smoke:client-boundaries` 和 `smoke:data-boundaries`。这些检查会约束 `server/services/v1-api.ts` / `server/services/social-v1-api.ts` 的入口行数预算、模块委托边界和上传解析归属，也会检查后台页面继续复用 `NexusAdminShell` / `NexusDashboard`、不回流旧 `NexusConsole`，检查 `apps/miniapp` / `apps/mobile` 继续复用 `@touchx/api-client`，并固定 V1 阶段继续使用 D1 `nexus_state.payload` 严格持久化而不提前引入 PostgreSQL / Redis / Docker Compose，避免 V1 handler、后台 UI、端侧 API wrapper 或基础设施范围重新膨胀。

V1 生产验收 gate（需要公网 HTTPS 生产 API、真实生产凭据和真实 PDF 样本）：

```bash
cp apps/backend/.env.production-smoke.example apps/backend/.env.production-smoke.local
# 填入真实值后执行；.env.production-smoke.local 已被 .gitignore 忽略
set -a; source apps/backend/.env.production-smoke.local; set +a
pnpm --filter @touchx/backend check:v1-production-env
pnpm --filter @touchx/backend verify:v1-production
```

真实生产材料建议先复制 `apps/backend/.env.production-smoke.example` 到被忽略的 `apps/backend/.env.production-smoke.local`，再填入真实值并通过 `source` 导入，避免把 token 或真实 PDF 路径写进 tracked 文档。`check:v1-production-env` 只做本地材料预检，不访问生产 API、Cloudflare 或本地 smoke 服务，并会拒绝 example 中尚未替换的占位符；该预检通过后再执行完整生产聚合 gate。该聚合 gate 会先跑带真实 PDF 的本地 `smoke:local`，再串起 `smoke:cloudflare-live` 和 `smoke:production`；缺少管理员 token、真实学生学号、ClawDBot webhook token、ClawDBot + 飞书双通知通道、真实 PDF 或 Wrangler 登录态时会失败。`TOUCHX_SMOKE_AUTH_TOKEN` 必须填原始 token，不带 `Bearer` 前缀；完整生产 gate 必须通过 `TOUCHX_SMOKE_NOTIFICATION_CHANNELS` 提供 `wechat_clawdbot` 和 `feishu`，支持逗号或空格分隔，`TOUCHX_SMOKE_NOTIFICATION_CHANNEL` 仅保留给单通道 smoke 排障；`TOUCHX_SMOKE_STUDENT_NO`、`SMOKE_SCHEDULE_IMPORT_STUDENT_NO` 和 `SMOKE_REAL_PDF_EXPECT_STUDENT_NO` 必须是 6-32 位数字学生号；真实 PDF 路径必须是绝对路径，默认要求至少解析 8 条课程，并默认要求 PDF 内学号匹配 `TOUCHX_SMOKE_STUDENT_NO`；为避免本地导入 smoke 误写生产数据，该脚本会拒绝非 localhost / 127.0.0.1 的 `SMOKE_BASE_URL`，也会拒绝非公网 HTTPS、localhost / 127.0.0.1 / link-local / CGNAT / 私网地址的 `TOUCHX_SMOKE_BASE_URL`，避免把本地或内网 API 当作生产 API 验收；`TOUCHX_SMOKE_AUTH_LOGOUT` 只能留空或设为 `1`，设为 `1` 时会在最后额外验证 admin logout 并撤销当前 token。

## 运行时自检（防回归）

启动本地服务后执行：

```bash
pnpm --filter @touchx/backend smoke:local
```

可通过 `SMOKE_BASE_URL` 覆盖目标地址（默认 `http://127.0.0.1:9986`）。

如果要把提醒与导入链路一起跑通，建议同时传这些环境变量：

```bash
SMOKE_HEARTBEAT_TOKEN=local-heartbeat-token \
SMOKE_BOT_DELIVERY_TOKEN=local-bot-token \
SMOKE_SCHEDULE_IMPORT_STUDENT_NO=2305100613 \
pnpm --filter @touchx/backend smoke:local
```

说明：

- 当同时提供 `SMOKE_HEARTBEAT_TOKEN` 和 `SMOKE_BOT_DELIVERY_TOKEN` 时，脚本会在本地执行一次真实入队、重复去重验证，以及一条投递 ack。
- 当提供 `SMOKE_SCHEDULE_IMPORT_STUDENT_NO` 时，脚本会以 mock 用户会话跑一次单文件 PDF 导入，并验证任务进入终态且失败场景带 `errorCode`。
- 当同时提供 `SMOKE_SCHEDULE_IMPORT_STUDENT_NO` 和 `SMOKE_REAL_PDF_PATH` 时，脚本会额外调用用户侧 PDF 预览接口验证真实 PDF 至少解析出 `SMOKE_REAL_PDF_MIN_ENTRIES` 条课程。本地默认 1 条，`verify:v1-production` 会强制提升到至少 8 条；可用 `SMOKE_REAL_PDF_EXPECT_STUDENT_NO` 校验 PDF 内学号，生产聚合 gate 默认使用 `TOUCHX_SMOKE_STUDENT_NO` 校验。

真实 PDF 样本验收示例：

```bash
SMOKE_SCHEDULE_IMPORT_STUDENT_NO=2305100613 \
SMOKE_REAL_PDF_PATH=/absolute/path/real-schedule.pdf \
SMOKE_REAL_PDF_MIN_ENTRIES=8 \
SMOKE_REAL_PDF_EXPECT_STUDENT_NO=2305100613 \
pnpm --filter @touchx/backend smoke:local
```

Cloudflare 配置静态验收：

```bash
pnpm --filter @touchx/backend smoke:cloudflare-config
```

该脚本不访问 Cloudflare，只检查 `wrangler.toml` 内必须的 D1/R2/Queue binding、queue producer/consumer 一致性、Cron 表达式，以及 D1 migration 文件是否存在；真实资源是否已创建仍需 `wrangler whoami` 后用 Cloudflare 账号复核。

Cloudflare 真实资源只读验收：

```bash
pnpm --filter @touchx/backend smoke:cloudflare-live
```

该脚本需要本机已登录 Cloudflare Wrangler，只执行只读检查：`whoami`、D1 列表、R2 bucket 列表/详情、Queue 列表/详情、Worker deployment 列表，以及 D1 远端未应用 migration 检查；不会创建、更新、删除或部署任何资源。它不放入默认 `verify:v1-local`，避免本地开发机必须持有生产 Cloudflare 凭证。

生产 smoke：

```bash
pnpm --filter @touchx/backend smoke:production
```

默认验证健康检查、受保护接口鉴权、bootstrap 管理员密码初始化，以及弱 fallback session token 被拒绝；不会发送外部通知，也不会调用入站 webhook。要执行真实 ClawDBot / 飞书外部投递 smoke，必须显式开启并提供管理员 token：

```bash
TOUCHX_SMOKE_EXTERNAL_DELIVERY=1 \
TOUCHX_SMOKE_AUTH_TOKEN=... \
TOUCHX_SMOKE_NOTIFICATION_CHANNELS=wechat_clawdbot,feishu \
pnpm --filter @touchx/backend smoke:production
```

可选变量：

- `TOUCHX_SMOKE_BASE_URL`：公网 HTTPS 生产 API 地址，默认 `https://schedule-backend.tagzxia.com`；`smoke:production` 和完整生产验收都会拒绝非 HTTPS、本地、link-local、CGNAT 和私网地址。
- `TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO`：校验生产 bootstrap 管理员账号/学号是否符合预期。
- `TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD`：用于生成弱 fallback session token 的候选默认管理员密码，默认 `123456`。
- `TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK=1`：跳过弱 fallback session token 拒绝检查，仅用于临时排障；生产验收不建议跳过。
- `TOUCHX_SMOKE_AUTH_TOKEN`：管理员 token；提供后会校验 `/api/v1/admin/me`。
- `TOUCHX_SMOKE_AUTH_LOGOUT=1`：额外验证 admin logout 撤销当前 token。该检查会让传入 token 失效，默认关闭；完整生产预检只接受空值或 `1`。
- `TOUCHX_SMOKE_STUDENT_NO`：可选真实学生学号；提供后会验证生产 `/api/v1/auth/login` 和 `/api/v1/auth/me` 仍返回 `legacy_student_no` 登录模式；完整生产验收要求 6-32 位数字。
- `TOUCHX_SMOKE_CLAWDBOT_WEBHOOK=1`：显式开启真实 ClawDBot webhook 入站 smoke；该检查会发送不 commit 的测试消息并要求至少解析出一个候选。
- `TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN`：真实 ClawDBot webhook token；完整生产验收必填。
- `TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT`：ClawDBot webhook smoke 文本，默认 `周三下午3点复习数据结构`。
- `TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE=1`：可选只读检查；需要管理员 token，验证生产已有 `sourceQueue=notification` 的通用通知投递记录。
- `TOUCHX_SMOKE_EXTERNAL_DELIVERY=1`：显式开启真实外部通知投递 smoke。
- `TOUCHX_SMOKE_NOTIFICATION_CHANNELS`：逗号或空格分隔的通知通道列表；完整生产验收必须同时包含 `wechat_clawdbot` 和 `feishu`。`TOUCHX_SMOKE_NOTIFICATION_CHANNEL` 仍可用于单通道排障。
- `TOUCHX_SMOKE_NOTIFICATION_TITLE` / `TOUCHX_SMOKE_NOTIFICATION_BODY`：测试消息内容。

生产完整验收建议直接跑：

```bash
pnpm --filter @touchx/backend verify:v1-production
```

## Cloudflare 部署

先确认 Cloudflare 登录：

```bash
pnpm --filter @touchx/backend exec wrangler whoami
```

部署：

```bash
pnpm --filter @touchx/backend run deploy
```

默认会发布并绑定自定义域名：`schedule-backend.tagzxia.com`。

D1 初始化（首次）：

```bash
pnpm --filter @touchx/backend exec wrangler d1 execute touchx-nexus-prod --file server/data/migrations/001_nexus_state.sql
pnpm --filter @touchx/backend exec wrangler d1 execute touchx-nexus-prod --file server/data/migrations/002_schedule_import_jobs.sql
pnpm --filter @touchx/backend exec wrangler d1 execute touchx-nexus-prod --file server/data/migrations/003_schedule_reminder_deliveries.sql
```

R2/Queue（首次）：

```bash
pnpm --filter @touchx/backend exec wrangler r2 bucket create touchx-schedule-import-bucket
pnpm --filter @touchx/backend exec wrangler queues create touchx-schedule-import-queue
```

生产变量建议使用 Cloudflare Secrets（不要写入 `wrangler.toml`）：

```bash
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_ADMIN_LOGIN_PASSWORD
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_SESSION_TOKEN_SECRET
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_HEARTBEAT_TOKEN
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_HEARTBEAT_TIMEZONE
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_BOT_DELIVERY_TOKEN
pnpm --filter @touchx/backend exec wrangler secret put NEXUS_REMINDER_DELIVERY_QUEUE
```

## GitHub 自动部署

已提供工作流：`/.github/workflows/deploy-backend-cloudflare.yml`。

需要在 GitHub 仓库设置以下 Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 课表 PDF 导入 API（管理员）

- `POST /api/v1/admin/schedule-import/jobs`
  - `multipart/form-data`
  - 允许两类登录态：
    - `/nexus` 管理员会话
    - 小程序/社交端登录后，`adminRole` 为 `super_admin` 或 `operator` 的 Bearer token
  - 字段：
    - `files[]`: 1~30 个 PDF 文件（单文件 <= 10MB）
    - `mappings`: JSON 字符串，数组项为 `{ "fileName": "...", "studentNo": "...", "term": "..." }`
      - `studentNo` 允许留空，后端会按顺序自动识别：`PDF 内学号` -> `文件名数字` -> `PDF 姓名匹配现有用户`
- `GET /api/v1/admin/schedule-import/jobs?limit=20`：最近任务 ID 列表
- `GET /api/v1/admin/schedule-import/jobs/:jobId`：任务详情与每文件结果

示例：

```bash
curl -X POST "http://127.0.0.1:9986/api/v1/admin/schedule-import/jobs" \
  -H "authorization: Bearer $NEXUS_TOKEN" \
  -F "files[]=@/absolute/path/1774529087027_蔡贵梅(2025-2026-2)课表.pdf" \
  -F "files[]=@/absolute/path/1774528344099_李春龙(2025-2026-2)课表.pdf" \
  -F 'mappings=[{"fileName":"1774529087027_蔡贵梅(2025-2026-2)课表.pdf","studentNo":"2305100546","term":"2025-2026-2"},{"fileName":"1774528344099_李春龙(2025-2026-2)课表.pdf","studentNo":"2405400108","term":"2025-2026-2"}]'
```

小程序管理员单文件导入也是复用同一路径，只是每次只传一个 `files[]` 与一条 `mappings`。

失败场景会尽量返回结构化错误，当前已覆盖：

- `TEMPLATE_MISMATCH`
- `COURSE_BLOCK_PARSE_FAILED`
- `EMPTY_SCHEDULE`
- `PDF_OBJECT_MISSING`
- `PDF_EMPTY`
