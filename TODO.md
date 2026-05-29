# TouchX TODO

## 当前架构决策

- 后台统一收敛到 `apps/backend`：Nuxt API + 内置管理页面。
- 独立 `apps/cms` 已移除；后续不再维护 React/Vite CMS 沙盒。
- `/api/**` 只放接口 / JSON / webhook；`/` 与 `/nexus/**` 只放后台页面。
- 后台 UI 统一按 shadcn 风格推进：简约、低饱和、token 化、黑白灰为主。
- 微信小程序 / 多小程序：`apps/miniapp` Taro + React 作为未来小程序主路线。
- iOS / Android 原生 App：`apps/mobile` React Native CLI / 原生 RN 工程，不使用 Expo。
- 旧 uni-app 小程序：`apps/microapp` 短期保留，作为线上稳定版本和迁移参照。
- 跨端共享逻辑：放在 `packages/*`，不要绑定具体 UI 平台。

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
- [ ] 统一所有后台表单、按钮、Badge、Table、Dialog 为共享组件或类名。
- [ ] 为 `/api/v1/admin/dashboard` 增加 focused API 测试。

## 通知渠道短期任务

- [x] 落地飞书 provider 配置模型：`webhook_bot` / `tenant_app`、`receiveIdType`、`defaultReceiveId`。
- [x] 后台通知通道页支持飞书机器人 webhook 与企业自建应用配置。
- [x] 后端飞书 adapter 支持企业自建应用：获取 `tenant_access_token` 后调用飞书消息 API。
- [x] 飞书机器人签名发送支持 timestamp/sign。
- [x] reminder candidate 入队统一使用 channel order 策略，`primary_then_fallback` 先投主通道、失败后生成备用通道 delivery。
- [ ] 飞书应用用户级接收人绑定，不再只依赖全局 `defaultReceiveId`。
- [ ] 通知投递记录增加手动重试单条 failed delivery 的后台操作。
- [ ] 为 `/api/v1/admin/notification-*` 增加 API-level 权限和 adapter 回归测试。
- [ ] 将 `v1-api.ts` 中 notification 路由逐步拆到独立 handler/service。

## ClawDBot / AI 日程交互

- [x] 新增 ClawDBot + AI 课程交互模拟接口：`POST /api/v1/bot/clawdbot/simulate`。
- [x] 模拟接口支持从自然语言提取日程候选、返回机器人 text reply，并可用 `commit=true` 写入个人日程。
- [x] 模拟接口限制为 localhost，远程调用需 `x-clawdbot-sim-token` / `x-bot-delivery-token`。
- [x] 给模拟接口增加一个最小后台工具入口，方便输入消息并查看 reply/candidates。
- [ ] 接入真实 ClawDBot webhook 回调：校验 token / 解析用户 / 调用模拟逻辑 / 返回或推送 reply。
- [ ] 用生产 ClawDBot webhook 做一次真实端到端 smoke。

## 学生端 / 多端路线

- [x] 新增 `apps/miniapp` Taro + React + TypeScript 骨架。
- [x] 新增 `apps/mobile` React Native CLI / 原生 RN 工程骨架。
- [x] 新增共享包：`shared` / `calendar-core` / `api-client` / `notification-core` / `ui-tokens`。
- [x] Taro 首批页面接入真实 API：今日、周视图、日程源、个人事项、我的。
- [ ] 保持 `apps/microapp` 不动，作为线上稳定版本和迁移参照。
- [ ] Taro 稳定后，将 `apps/microapp` 归档或替换。
- [ ] RN App 接入共享包和新 Calendar API。

## V1 暂缓

- RN 正式版。
- Taro 全量替换 uni-app。
- Docker + PostgreSQL + Redis。
- 教务系统 connector。
- 真实图片 OCR 产品化。
- 非日程主线功能扩展。

## V1 本地验收证据

- `apps/miniapp/src` 已无 demo / mock / fallback 样例数据主线，学生端通过真实 API 读取数据。
- `auth/login` 和 `auth/me` 返回真实登录模式，新账号为 `account_password`，旧学号兼容为 `legacy_student_no`。
- `apps/backend/server/services/notification-delivery-module.test.mjs` 使用本地 loopback HTTP server 验证 ClawDBot webhook adapter 的真实 HTTP POST。
- `apps/backend/scripts/smoke-local.sh` 覆盖 `/health`、`/api/v1`、`/nexus/login`、`/nexus/preview`。
- 最近通过的本地 gate：backend type-check / build、miniapp type-check / build:weapp、calendar-core tests、后端 focused node tests、`git diff --check`。

## 上线前环境验收

- 使用生产 ClawDBot 或飞书 webhook 配置做一次真实外部投递 smoke。
- 使用真实 PDF 课表样本验证解析质量，而不是只验证伪 PDF 的队列和错误终态。
- 复核生产管理员密码、学生学号登录策略和 Cloudflare D1/R2/Queue binding。
