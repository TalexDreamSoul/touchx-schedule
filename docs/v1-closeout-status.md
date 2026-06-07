# V1 收口状态

日期：2026-06-01

## 当前范围

V1 收口聚焦在继续扩功能前先降低主要工程风险。当前基线保持外部 `/api/v1/*` 路径稳定，保留 D1 `nexus_state.payload` 作为 V1 持久化模型，并把 Docker / PostgreSQL / Redis / job runner 放到 V1 后处理。

## 已完成能力

### 后端 API 边界

- `apps/backend/server/services/v1-api.ts` 已从原来的混合大 handler 收敛为轻入口，主要负责请求校验、路由委托、响应 envelope 和顶层 error boundary。
- `apps/backend/server/services/social-v1-api.ts` 已收敛为 legacy 协调层，旧 social / account / AI / upload 路由委托到 `apps/backend/server/modules/legacy/*`。
- 新后端模块按职责拆分为 `admin`、`auth`、`bot`、`calendar`、`dev`、`food`、`import`、`media`、`notification`、`party-game`、`schedule`、`legacy`。
- 已围绕拆出的 handler / service 增加 focused tests，后续改动不再依赖旧巨型 handler 做回归。

### 后台 UI 边界

- Nexus 后台页面统一复用 `NexusAdminShell` / `NexusDashboard`，不再由每个页面重复维护布局结构。
- 共享 `.rx-*` 后台基础类收敛在 shell 边界内。
- `smoke:admin-ui-boundaries` 会防止旧 `NexusConsole` 模式回流。

### 通知模型收口

- 新 reminder delivery 默认写入通用 `notificationDeliveries`。
- `schedule_reminder_deliveries` 只作为 `NEXUS_REMINDER_DELIVERY_QUEUE=legacy` 的显式 legacy fallback 保留。
- 通知通道、绑定、投递、提醒规则和提醒候选行为已拆到 focused notification modules。
- production smoke 已支持显式 opt-in 的 ClawDBot / 飞书真实外部投递，以及 ClawDBot webhook 入站链路。

### 端侧 API 与 token 收敛

- `apps/miniapp` 和 `apps/mobile` 已复用 `@touchx/api-client` 作为共享 API 层。
- API base URL 解析集中处理，支持运行时和环境变量覆盖，不再由各端维护独立硬编码 wrapper。
- `apps/miniapp` 和 `apps/mobile` 的课表默认学期、节次、星期和事件色复用 `@touchx/shared` / `@touchx/ui-tokens`。
- `apps/miniapp` 页面主题变量由 `packages/ui-tokens` 的 miniapp page theme / event tone 映射输出，再通过 `miniappPageThemeStyles` 注入页面根节点。
- `smoke:client-boundaries` 防止 miniapp/mobile 重新复制 `/api/v1` wrapper、自建裸 `fetch` API client、回流端侧 schedule 默认值、miniapp 主题 class map、mobile 本地色板或 mobile 空依赖本地时间 memo；mobile today/schedule 通过 `today-brief` 维护 `serverOffsetMs` 计算当前周次/今日课程。
- `smoke:miniapp-parity` 防止 Taro today/week 真实日程 API 状态流、profile 账号/昵称、微信 ClawDBot 通知绑定、PDF 导入预览、自定义日程源发布和订阅/取消订阅退回展示页或 mock 流程；同时要求 miniapp today/week 通过 `today-brief` 维护 `serverOffsetMs` 计算当前周次/今日课程，且要求 `apps/microapp/src/pages.json` 的每个旧路由在 `docs/miniapp-route-decision.md` 中有 `Covered` / `Partial` / `Deferred` 决策。
- `apps/backend/server/services/miniapp-schedule-helper.test.mjs` 对 miniapp/mobile 的 schedule helper 做打包后函数级回归，覆盖服务端时间校准后的当前日/周次、进行中课程和问候语。

### 数据与基础设施护栏

- V1 仍使用 D1 `nexus_state.payload`；PostgreSQL、Redis、Docker Compose 和 job runner 明确推迟到 V1 后。
- 已存在但损坏的 D1 payload 会 fail closed，不再被 bootstrap 默认状态覆盖。
- 旧 payload 缺少新增顶层集合时会补齐缺失集合。
- Cloudflare config smoke 会检查 D1 / R2 / Queue binding、Cron 和 D1 migration 文件。

### 小程序路线决策

- `apps/miniapp` 是后续学生课表体验的新主线。
- `apps/microapp` 在 V1 阶段继续作为生产稳定 fallback，直到 Taro 路线在课表、个人资料、导入、通知和社交入口上达到 parity。
- 详细决策与 parity gates 记录在 `docs/miniapp-route-decision.md`。

## 本地验证 gate

把当前工作树视为本地 release candidate 前，至少执行：

```bash
pnpm --filter @touchx/backend verify:v1-local
pnpm --filter @touchx/miniapp build:weapp
pnpm verify:v1-release
```

`verify:v1-local` 覆盖 backend type-check、后端 node tests、`pnpm test:packages` workspace 包测试、miniapp/mobile type-check、API/admin/client/miniapp parity/data/Cloudflare config boundary smoke、smoke 脚本语法和 `git diff --check`。

`verify:v1-release` 会先跑后端 V1 本地 gate，再跑 `@touchx/miniapp build:weapp`、`@touchx/microapp type-check` 和 `@touchx/microapp build:mp-weixin`，是推荐的本地 release-candidate 命令。替换或归档 `apps/microapp` 前还必须按 `docs/miniapp-wechat-smoke-checklist.md` 补 WeChat DevTools 手工 smoke。

最近通过的本地 release-candidate gate（2026-06-08）：`pnpm verify:v1-release`。该次验证覆盖后端 V1 本地 gate、Taro weapp 产物构建、旧 uni-app type-check 与微信小程序构建。

## 仍需生产验收

V1 还不能算完整验收，必须使用真实生产材料执行：

```bash
cp apps/backend/.env.production-smoke.example apps/backend/.env.production-smoke.local
# 填入真实值后执行；.env.production-smoke.local 已被 .gitignore 忽略
set -a; source apps/backend/.env.production-smoke.local; set +a
pnpm --filter @touchx/backend check:v1-production-env
pnpm --filter @touchx/backend verify:v1-production
```

其中 `check:v1-production-env` 只校验本地材料完整性和安全边界，不访问生产 API、Cloudflare 或本地 smoke 服务，并会拒绝 example 中尚未替换的占位符；正式验收仍必须运行 `verify:v1-production`。`TOUCHX_SMOKE_AUTH_TOKEN` 必须填原始 token，不带 `Bearer` 前缀且不能包含空白字符；`TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN` 也不能包含空白字符；完整生产 gate 必须通过 `TOUCHX_SMOKE_NOTIFICATION_CHANNELS` 提供 `wechat_clawdbot` 和 `feishu`，支持逗号或空格分隔，`TOUCHX_SMOKE_NOTIFICATION_CHANNEL` 仅保留给单通道 smoke 排障；`TOUCHX_SMOKE_STUDENT_NO`、`SMOKE_SCHEDULE_IMPORT_STUDENT_NO` 和 `SMOKE_REAL_PDF_EXPECT_STUDENT_NO` 必须是 6-32 位数字学生号；`SMOKE_REAL_PDF_EXPECT_STUDENT_NO` 未显式设置时默认使用 `TOUCHX_SMOKE_STUDENT_NO`；真实 PDF 路径必须是绝对路径；`TOUCHX_SMOKE_AUTH_LOGOUT` 只能留空或设为 `1`；`TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK` 必须为空，完整生产 gate 不允许跳过弱 fallback session token 拒绝检查。`TOUCHX_SMOKE_BASE_URL` 必须是公网 HTTPS 生产 API，不能指向本地、link-local、CGNAT 或私网地址。

生产 gate 需要覆盖：

- 使用真实 webhook token 的 ClawDBot webhook 入站 smoke。
- ClawDBot 与飞书真实外部投递 smoke。
- 真实 PDF 课表解析质量，至少解析 8 条课程且学号匹配预期学生。
- 生产默认通知队列使用通用 `notificationDeliveries`。
- 生产旧学号登录策略。
- Cloudflare D1 / R2 / Queue / Worker live 资源可见性、管理员/session/heartbeat/bot/提醒队列 Worker secret 名称可见性与 migration 状态。

该 gate 会拒绝非公网 HTTPS、本地、link-local、CGNAT 或私网 `TOUCHX_SMOKE_BASE_URL`，并要求真实 PDF 导入 smoke 只打 localhost，避免本地导入检查误写生产数据。

## 建议提交批次

1. 后端 API 模块化与 focused handler tests。
2. 通知投递模型收口、smoke gates 和生产验收脚本。
3. miniapp / mobile 共享 API client 收敛。
4. Nexus 后台 shell / UI 边界统一。
5. 文档、roadmap、release 命令和 V1 收口说明。

除非明确要求，`.spec-workflow/`、`.playwright-mcp/` 和 `.serena/` 不进入提交。
