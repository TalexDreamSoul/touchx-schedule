# TouchX TODO

## 当前架构决策

- 后台统一收敛到 `apps/backend`：Nuxt API + 内置管理页面。
- 独立 `apps/cms` 已移除；后续不再维护 React/Vite CMS 沙盒。
- `/api/**` 只放接口 / JSON / webhook；`/` 与 `/nexus/**` 只放后台页面。
- 后台 UI 统一按 shadcn 风格推进：简约、低饱和、token 化、黑白灰为主。
- 微信小程序 / 多小程序：`apps/miniapp` Taro + React 作为未来小程序主路线。
- iOS / Android 原生 App：`apps/mobile` React Native CLI / 原生 RN 工程，不使用 Expo。
- 桌面版短期定义为 `apps/backend` 内置 Nexus Web 工作台；不新增 Electron / Tauri 工程。
- 旧 uni-app 小程序：`apps/microapp` 短期保留，作为线上稳定版本和迁移参照。
- 跨端共享逻辑：放在 `packages/*`，不要绑定具体 UI 平台；UI 层按 Web/RN/Taro/uni-app 分端实现。
- 整体主题以 `packages/ui-tokens` 为语义源头，端侧只做平台映射和必要布局差异。

目标架构：

```txt
apps/
  backend/          # Nuxt API + 内置后台
  microapp/         # 旧 uni-app，小程序迁移期保留
  miniapp/          # 新 Taro React 小程序
  mobile/           # React Native CLI App

packages/
  shared/           # 类型、枚举、常量
  calendar-core/    # 日程合成、覆盖、冲突、提醒候选
  api-client/       # API SDK
  notification-core/# 通知模型、渠道抽象、提醒策略
  ui-tokens/        # 跨端设计 token
```

---

## Backend + 后台 UI 短期任务

- [x] 移除独立 `apps/cms` workspace、根脚本和 lockfile 依赖。
- [x] 根路径 `/` 改为后台主 Dashboard，不再返回 JSON。
- [x] 未登录或登录态异常访问 `/` / `/nexus/**` 跳 `/nexus/login`。
- [x] 新增 `/api/health`，`/health` 兼容保留。
- [x] 默认后台管理员账号统一为 `admin@schedule.com`，默认密码为 `123456`。
- [x] 后台通用 Shell 切到 shadcn 风格基础样式。
- [x] 登录 / 初始化页面切到 shadcn 风格基础样式。
- [x] 将旧 `NexusConsole.vue` 主线模块拆成独立 Nuxt 页面。
- [x] 将剩余运营模块拆成独立 Nuxt 页面：Foods / Campaigns / Media / Bots / Heart Open Word Bank。
- [x] 删除旧 `NexusConsole.vue`，`/nexus/[module]` 仅保留兼容重定向。
- [x] 统一后台表单、按钮、Badge、Table 与常用操作状态为共享 Shell 类名。
- [x] 为 `/api/v1/admin/dashboard` 增加 focused API 测试。
- [x] 将 `v1-api.ts` 中 admin/auth 核心路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 calendar sources / subscriptions / settings / effective 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 calendar/me/personal-events 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 calendar/schedules ICS 导出路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 classes / schedules / me schedule patches-conflicts 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 admin/users 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 media/assets / admin/media-assets 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 bot/templates / bot/jobs / bot/deliveries 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 party-games / heart-open word bank 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 import candidate / schedule-import 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 food / location / food-campaign / pricing 路由拆到独立 handler/service。
- [x] 将 `v1-api.ts` 中 admin dashboard / admin preview / admin audit / me profile / dev reset-store 剩余路由拆到独立 handler/service。
- [x] 将旧兼容 `social-v1-api.ts` 中 `/api/v1/notifications*` 路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 ClawDBot simulate / webhook 路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 AI chat / OCR preview-confirm / schedule parse-commit 路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 `social/circles*` 路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 `social/me`、用户搜索、subscription requests / subscriptions 路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 social activity / free-heatmap / smart lead 路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 food candidate / admin food candidate 非上传路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 `social/food-campaigns*` 路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 auth/profile/bind-student/upload/schedules-student 等账号资料尾部路由拆到独立 legacy handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 `social/subscribe*` 旧关系入口并入 legacy social relation handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 `ai/attachments`、`social/food-candidates/evidence` 上传边界拆到 legacy upload handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 exams/calendar/today brief/theme images/schedule corrections 尾部接口拆到 legacy companion handler，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 legacy 共享状态、持久化 snapshot hydrate / serialize、通知绑定兼容判断拆到 `legacy-state`，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中用户查找、绑定目标、展示名、ClawDBot 用户创建 helper 拆到 `legacy-user-utils`，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中社交订阅边同步、可见性、通知去重、候选日程冲突 helper 拆到 `legacy-social-utils`，并补 focused tests。
- [x] 将旧兼容 `social-v1-api.ts` 中 error/auth/session/env/url/audit/exam date/path 运行时 helper 拆到 `legacy-runtime-utils`，并补 focused tests。

## 通知渠道短期任务

- [x] 落地飞书 provider 配置模型：`webhook_bot` / `tenant_app`、`receiveIdType`、`defaultReceiveId`。
- [x] 后台通知通道页支持飞书机器人 webhook 与企业自建应用配置。
- [x] 后端飞书 adapter 支持企业自建应用：获取 `tenant_access_token` 后调用飞书消息 API。
- [x] 飞书机器人签名发送支持 timestamp/sign。
- [x] reminder candidate 入队统一使用 channel order 策略，`primary_then_fallback` 先投主通道、失败后生成备用通道 delivery。
- [x] heartbeat reminder delivery 支持 `notification` 队列模式，可将旧 D1 reminder 投递迁入通用 `notificationDeliveries`。
- [x] `NEXUS_REMINDER_DELIVERY_QUEUE=notification` 贯通手工 heartbeat、Cloudflare scheduled Cron、Bot pending/ack 与后台投递记录筛选。
- [x] reminder delivery 默认队列切换为 `notificationDeliveries`，旧 `schedule_reminder_deliveries` 仅保留为 `NEXUS_REMINDER_DELIVERY_QUEUE=legacy` 兼容 fallback。
- [x] 飞书应用用户级接收人绑定，不再只依赖全局 `defaultReceiveId`。
- [x] 通知投递记录增加手动重试单条 failed delivery 的后台操作。
- [x] 为 `/api/v1/admin/notification-*` 增加 API-level 权限和 adapter 回归测试。
- [x] 将 `v1-api.ts` 中 admin notification 路由拆到独立 handler/service。
- [x] 将用户侧 notification bindings / ClawDBot QR 路由拆到独立 handler/service。
- [x] 将用户侧 reminder rules / reminder candidates 路由拆到独立 handler/service。

## ClawDBot / AI 日程交互

- [x] 新增 ClawDBot + AI 课程交互模拟接口：`POST /api/v1/bot/clawdbot/simulate`。
- [x] 模拟接口支持从自然语言提取日程候选、返回机器人 text reply，并可用 `commit=true` 写入个人日程。
- [x] 模拟接口限制为 localhost，远程调用需 `x-clawdbot-sim-token` / `x-bot-delivery-token`。
- [x] 给模拟接口增加一个最小后台工具入口，方便输入消息并查看 reply/candidates。
- [x] 接入真实 ClawDBot webhook 回调：校验 token / 解析用户 / 调用模拟逻辑 / 返回 text reply。
- [x] 生产 smoke 脚本支持显式 opt-in 的 ClawDBot / 飞书真实外部投递门禁。
- [x] 生产 smoke 脚本支持显式 opt-in 的 ClawDBot webhook 入站门禁，完整生产 gate 会要求真实 webhook token 并发送不 commit 的测试消息。
- [ ] 使用真实生产材料执行 ClawDBot webhook 入站 smoke。

## 学生端 / 多端路线

- [x] 新增 `apps/miniapp` Taro + React + TypeScript 骨架。
- [x] 新增 `apps/mobile` React Native CLI / 原生 RN 工程骨架。
- [x] 新增共享包：`shared` / `calendar-core` / `api-client` / `notification-core` / `ui-tokens`。
- [x] Taro 首批页面接入真实 API：今日、周视图、日程源、个人事项、我的。
- [x] `apps/miniapp` 与 `apps/mobile` 核心 API 调用收敛到 `@touchx/api-client`，端侧 wrapper 只保留平台存储、上传和跨端 API base URL 环境覆盖适配。
- [x] 小程序路线决策已记录：`apps/miniapp` 作为后续主线，`apps/microapp` V1 保持稳定参照，暂不归档替换。
- [x] 保持 `apps/microapp` 不动，作为线上稳定版本和迁移参照。
- [x] 为 `apps/microapp` 现有页面补齐 Taro 覆盖 / Partial / V1 defer 决策矩阵，并纳入 `smoke:miniapp-parity`。
- [ ] Taro 稳定后，将 `apps/microapp` 归档或替换。
- [x] RN App 接入共享包和新 Calendar API。
- [x] 将 `apps/miniapp` 主题变量逐步映射到 `packages/ui-tokens`，避免端侧颜色继续发散。
- [x] 为 `apps/miniapp` 补齐 profile、通知绑定、PDF 导入和自定义日程源发布 parity gates。
- [ ] 评估学生端 Web/PWA 前，先完成 miniapp/RN 核心流程稳定和共享 API / token 收敛。

## V1 暂缓

- RN 正式版。
- Taro 全量替换 uni-app。
- 独立桌面客户端（Electron / Tauri）。
- Docker + PostgreSQL + Redis。
- 教务系统 connector。
- 真实图片 OCR 产品化。
- 非日程主线功能扩展。

## V1 本地验收证据

- `apps/miniapp/src` 已无 demo / mock / fallback 样例数据主线，学生端通过真实 API 读取数据。
- `auth/login` 和 `auth/me` 返回真实登录模式，新账号为 `account_password`，旧学号兼容为 `legacy_student_no`。
- `auth/logout` / `admin/logout` / legacy `auth/logout` 会登记撤销态，已登录 session 后续会被鉴权层拒绝；`api-envelope` focused test 覆盖 revoked user/admin token 被拒绝，未登记的旧签名 token 保持兼容校验。
- `domain-store` 会在旧 D1 `nexus_state.payload` 缺少顶层集合字段时统一补空数组，并覆盖缺 `sessions` / 通知 / import / party-game 等新集合的旧 payload 升级回归。
- `nexus-state-manager` 对已存在但为空、非法 JSON 或结构不支持的 `nexus_state.payload` 会中止请求，不再 fallback 到 bootstrap 覆盖持久化状态。
- `calendar/sources/:id` 详情已补 visibility 权限校验，私有日程源仅 owner / admin 可读。
- `apps/backend/server/services/notification-delivery-module.test.mjs` 使用本地 loopback HTTP server 验证 ClawDBot webhook adapter 的真实 HTTP POST。
- `apps/backend/scripts/smoke-local.sh` 覆盖 `/health`、`/api/v1`、`/nexus/login`、`/nexus/preview`。
- `apps/backend/scripts/smoke-local.sh` 支持 `SMOKE_REAL_PDF_PATH` 真实 PDF 样本解析质量门禁，避免只验证伪 PDF 的错误终态。
- `apps/backend/scripts/smoke-api-boundaries.mjs` 固化 `/api/v1` 入口边界：`v1-api.ts` 和 `social-v1-api.ts` 有行数预算，必须委托到 `server/modules/*`，且不能重新拥有 multipart 上传解析。
- `apps/backend/scripts/smoke-admin-ui-boundaries.mjs` 固化后台 UI 边界：业务页必须复用 `NexusAdminShell` / `NexusDashboard`，共享 `.rx-*` 基础类只能在 shell 内定义，旧 `NexusConsole` 不能作为组件回流。
- `apps/backend/scripts/smoke-client-boundaries.mjs` 固化端侧 API / schedule / theme 边界：`apps/miniapp` 与 `apps/mobile` 必须继续复用 `@touchx/api-client`、共享 base URL 解析、共享课表默认值和 `calendarEventColors`；`apps/mobile` today/schedule 必须通过 `today-brief` 维护 `serverOffsetMs`，页面主题和主界面色板必须从 `miniappPageThemeStyles` / `mobileNativeTheme` / `calendarEventTones` 派生，不能重新硬编码 `/api/v1`、自建裸 `fetch` API wrapper、本地事件色 class map、本地 mobile palette 或空依赖本地时间 memo。
- `apps/backend/scripts/smoke-miniapp-parity.mjs` 固化 Taro 学生端代码级 parity：today/week 真实日程 API 的 loading、empty、error、未登录、已登录状态流，以及 profile 账号/昵称、微信 ClawDBot 通知绑定、PDF 导入预览、自定义日程源发布、订阅/取消订阅必须继续通过 `apps/miniapp/src/lib/api.ts` 的真实 API helper 和页面状态闭环；today/week 必须通过 `today-brief` 维护 `serverOffsetMs`，当前周次、今日课程和进行中判断不能直接依赖设备本地时间；同时解析 `apps/microapp/src/pages.json`，要求 `docs/miniapp-route-decision.md` 为每个旧路由写明 `Covered` / `Partial` / `Deferred` 决策，并要求 `docs/miniapp-wechat-smoke-checklist.md` 保留替换前手工 smoke 场景。
- `apps/backend/server/services/miniapp-schedule-helper.test.mjs` 使用打包后的 miniapp/mobile schedule helpers 做函数级回归：校验 `serverOffsetMs` 可从服务端 ISO 校准当前日期/周次、进行中课程和问候语，且无效服务端时间不会覆盖最后一次有效 offset。
- `apps/backend/scripts/smoke-data-boundaries.mjs` 固化 V1 数据/基础设施边界：D1 `nexus_state.payload` 仍是当前持久化模型，坏 payload 必须返回 503 而不是 bootstrap 覆盖；V1 收口阶段不得引入 PostgreSQL / Redis / Docker Compose 范围。
- `apps/backend/scripts/smoke-cloudflare-config.mjs` 静态检查 `wrangler.toml` 的 D1/R2/Queue binding、queue producer/consumer、Cron 和 D1 migration 文件。
- `apps/backend/scripts/smoke-cloudflare-live.mjs` 提供需要 Wrangler 登录的只读生产资源复核：D1/R2/Queue/Worker deployment 可见性、管理员/session/heartbeat/bot/提醒队列 Worker secret 名称可见性与远端 D1 migration 未应用检查；不进入默认本地 gate。
- `apps/backend/scripts/smoke-production.sh` 默认检查生产 bootstrap 管理员密码已初始化，并验证弱 fallback session token 被拒绝；即使设置 `TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD`，也始终检查默认 `fallback:123456` 候选，避免漏掉历史弱默认；提供管理员 token 后可校验 `/api/v1/admin/me`，`TOUCHX_SMOKE_AUTH_LOGOUT=1` 会在其他 opt-in 检查后执行会让 token 失效的 logout 撤销 smoke；提供 `TOUCHX_SMOKE_STUDENT_NO` 后可非破坏性复核生产旧学号登录仍返回 `legacy_student_no`；提供 `TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE=1` 后可只读复核生产已有 `sourceQueue=notification` 的通用通知投递记录；提供 `TOUCHX_SMOKE_NOTIFICATION_CHANNELS` 后可循环验证 ClawDBot / 飞书外部投递；提供 `TOUCHX_SMOKE_CLAWDBOT_WEBHOOK=1` 和 webhook token 后可验证 ClawDBot webhook 入站链路；这些 opt-in flag 直接运行时只接受空值或 `1`，避免拼错值被静默当作关闭。
- `apps/backend/scripts/verify-v1-production.sh` 聚合 V1 生产验收：要求管理员 token、真实学生学号、真实 ClawDBot webhook token、ClawDBot + 飞书双通知通道、真实 PDF 样本与 Wrangler 登录态，且生产学生号、本地导入学生号和 PDF 期望学生号必须是 6-32 位数字；先跑本地真实 PDF 解析 smoke，再串起 Cloudflare live 和生产 smoke；真实 PDF 默认要求至少 8 条课程且解析学号匹配真实学生号，预检会要求路径为绝对 PDF 文件路径；`SMOKE_BASE_URL` 必须保持 localhost / 127.0.0.1，避免本地导入 smoke 误写生产数据；`TOUCHX_SMOKE_BASE_URL` 必须是公网 HTTPS，不能指向 localhost / 127.0.0.1 / link-local / CGNAT / 私网地址，避免把本地或内网 API 当作生产 API 验收；完整生产 gate 会拒绝 `TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK`，也会拒绝已知 dummy/example token，避免跳过弱 fallback session token 拒绝检查或误把默认 smoke 当完整上线验收；缺材料会直接失败。
- 最近通过的本地 release-candidate gate（2026-06-08）：`pnpm verify:v1-release`，覆盖 `pnpm --filter @touchx/backend verify:v1-local`、`@touchx/miniapp build:weapp`、`@touchx/microapp type-check` 和 `@touchx/microapp build:mp-weixin`；其中后端本地 gate 覆盖 backend type-check、后端 node tests、`pnpm test:packages` workspace 包测试、miniapp / mobile type-check、`smoke:api-boundaries`、`smoke:admin-ui-boundaries`、`smoke:client-boundaries`、`smoke:miniapp-parity`、`smoke:data-boundaries`、`smoke:cloudflare-config`、`bash -n apps/backend/scripts/smoke-*.sh`、`git diff --check`。

## 上线前环境验收

- 使用真实生产材料执行 `pnpm --filter @touchx/backend verify:v1-production`，覆盖 ClawDBot webhook 入站、ClawDBot/飞书真实外部投递、真实 PDF 课表样本解析质量、生产默认通知队列、生产学号登录策略、Cloudflare D1/R2/Queue/Worker 真实资源与管理员/session/heartbeat/bot/提醒队列 Worker secret 名称可见性。生产管理员密码与 session secret 已有生产 smoke 门禁。
- V1 收口功能、验收命令、剩余生产材料和建议提交批次统一记录在 `docs/v1-closeout-status.md`。

## 接下来优先级

- 保持 `social-v1-api.ts` 作为 legacy 入口协调层稳定，新增旧兼容逻辑继续落到 `apps/backend/server/modules/legacy/*`，避免重新塞回大 handler。
- 保持 PostgreSQL / Docker / Redis / job runner 在 V1 后处理，不进入当前收口批次。
- 获取生产 ClawDBot / 飞书配置和真实 PDF 样本后，再补真实外部 smoke 与解析质量验收。
