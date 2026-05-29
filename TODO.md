# TouchX TODO

## Taro + React Native 多端路线确认

### 核心决策

- 后台 + CMS：继续使用 `apps/backend`，基于 Nuxt。
- 微信小程序 / 多小程序：新增 Taro + React 应用作为未来小程序主路线。
- iOS / Android 原生 App：使用 React Native CLI / 原生 RN 工程，不使用 Expo。
- 旧 uni-app 小程序：短期保留，作为线上稳定版本和迁移参照。
- 跨端共享逻辑：放在 `packages/*`，不要绑定具体 UI 平台。

目标架构：

```txt
apps/
  backend/          # Nuxt API + CMS
  microapp/         # 旧 uni-app，小程序迁移期保留
  miniapp/          # 新 Taro React 小程序
  mobile/           # React Native CLI App

packages/
  shared/           # 类型、枚举、常量
  calendar-core/    # 日程合成、覆盖、冲突、提醒候选
  api-client/       # API SDK
  notification-core/# 通知模型、渠道抽象、提醒策略
  ui-tokens/        # 跨端设计 token
  app-models/       # 可选：跨端业务 view-model / hooks
```

---

## 为什么可以直接用 Taro

- Taro 与 RN 不冲突。
- Taro 负责小程序和 H5，RN 负责 iOS / Android 原生 App。
- 两者都使用 React 心智，便于统一团队技术栈。
- 可以共享 TypeScript 业务包：
  - `@touchx/shared`
  - `@touchx/calendar-core`
  - `@touchx/api-client`
  - `@touchx/notification-core`
  - `@touchx/ui-tokens`
- UI 层不强行共享，避免牺牲端体验。

需要注意：

> 微信小程序不能直接运行 React Native runtime。

所以“小程序也用 RN”应理解为：

```txt
RN App 和 Taro 小程序共享 React 体系、业务模型、API、设计 token，
但 UI 组件分别用 RN / Taro 原生组件实现。
```

---

## 推荐技术栈

### Taro 小程序

- Taro 4
- React
- TypeScript
- Zustand / Jotai 作为状态管理候选
- 基础组件可评估 NutUI React Taro / Taroify
- 核心日历 UI 自研

### React Native App

- React Native CLI / 原生 RN 工程
- 不使用 Expo
- TypeScript
- React Navigation / Native Stack / Tabs
- iOS / Android 原生模块按需接入
- 本地通知、Widget、Live Activities 后续预研
- iOS 优先体验：手势、Sheet、Haptics、系统日历等

### 共享包

- `packages/shared`：领域类型、枚举、通用常量。
- `packages/calendar-core`：纯 TS 日程合成、订阅、覆盖、冲突、提醒候选。
- `packages/api-client`：小程序 / RN / CMS 共用 API SDK。
- `packages/notification-core`：通知渠道、模板、投递策略。
- `packages/ui-tokens`：颜色、间距、圆角、字体等设计 token。

---

## 短期执行计划

### 1. 更新 Roadmap 文档

- [x] 更新 `docs/touchx-calendar-platform-roadmap.md`：
  - 明确 Taro 是未来小程序主路线。
  - uni-app 是迁移期保留。
  - React Native CLI 是 iOS / Android 原生 App 主路线，不使用 Expo。
  - Taro 与 RN 共享业务包，但不强行共享 UI 组件。

### 2. 新增 Taro 小程序骨架

- [x] 新增 `apps/miniapp`。
- [x] 初始化 Taro + React + TypeScript。
- [x] 接入 monorepo workspace。
- [x] 配置基础页面：
  - `pages/today/index`
  - `pages/week/index`
  - `pages/sources/index`
  - `pages/profile/index`
- [x] 接入共享包：
  - `@touchx/shared`
  - `@touchx/calendar-core`
  - `@touchx/api-client`
  - `@touchx/ui-tokens`

### 3. 保留旧 uni-app

- [ ] 保持 `apps/microapp` 不动。
- [ ] 当前线上小程序继续由 uni-app 版本承载。
- [ ] 后续按页面逐步迁移到 Taro。

### 4. 新增共享包

- [x] 拆分 `packages/shared/src/calendar.ts`。
- [x] 拆分 `packages/shared/src/notification.ts`。
- [x] 拆分 `packages/shared/src/import.ts`。
- [x] 新增 `packages/calendar-core`。
- [x] 新增 `packages/api-client`。
- [x] 新增 `packages/ui-tokens`。

### 5. Taro 首批页面目标

- [x] 今日视图：展示今日有效日程，并支持创建 / 完成 / 归档个人 Todo。
- [x] 周视图：按周展示有效日程网格。
- [x] 订阅源列表：展示可订阅日程源，并支持登录后订阅已发布源。
- [x] 我的页面：登录态、用户信息、学号登录入口。

---

## 中期迁移计划

- [x] Taro 接入新 `CalendarSource` API。
- [ ] 迁移 uni-app 今日页面。
- [ ] 迁移 uni-app 周课表 / 周日程页面。
- [x] 迁移订阅管理。
- [ ] 迁移提醒设置。
- [x] 迁移个人事项 / Todo。
- [ ] 对比 Taro 与 uni-app：
  - 首屏速度
  - 包体积
  - 滚动性能
  - 日历网格性能
  - UI 还原度
  - 微信小程序兼容性
- [ ] Taro 稳定后，将 `apps/microapp` 归档或替换。

---

## 长期计划

- [x] 新增 `apps/mobile`，使用 React Native CLI / 原生 RN 工程骨架。
- [ ] RN App 接入共享包和新 Calendar API。
- [ ] RN 实现高质量 iOS / Android 日程体验。
- [ ] 小程序和 RN 共享：
  - 类型模型
  - API client
  - 日程合成逻辑
  - 提醒规则
  - 设计 token
  - 部分业务 view-model
- [ ] 小程序和 RN 分端实现 UI，避免牺牲体验。

---

## UI 组件原则

- 不追求一套 UI 跑所有端。
- 追求一套业务核心跑所有端。
- Taro 使用 `@tarojs/components`。
- RN 使用 `react-native` 组件。
- 核心日历组件分别实现。
- 视觉一致性通过 `packages/ui-tokens` 保证。

示例：

```txt
共享：
  colors
  spacing
  radius
  typography
  event type colors

分端：
  TaroEventCard
  RNEventCard
  TaroWeekCalendar
  RNWeekCalendar
```

---

## 下一步推荐

优先执行：

1. 更新 Roadmap 文档里的 Taro 决策。
已完成首批：

1. 更新 `docs/touchx-calendar-platform-roadmap.md`。
2. 创建 `apps/cms` React CMS 骨架。
3. 创建 `apps/miniapp` Taro 骨架。
4. 创建 `apps/mobile` React Native CLI 骨架。
5. 创建 `packages/ui-tokens` / `packages/calendar-core` / `packages/api-client` / `packages/notification-core`。
6. 接入后端 `/api/v1/calendar/*` 兼容 API。

下一步优先：安装新依赖并更新 lockfile，然后把 `apps/cms` 接入登录页、真实路由和更多 CRUD。

当前 V1 收口优先级：

0. 路由边界统一：`/api/**` 只放接口 / JSON / webhook，`/` 直接是 CMS 主页面，登录态异常跳 `/nexus/login`；`/nexus/**`、`/admin/**` 作为兼容页面路径；独立 `apps/cms` 只作为开发沙盒。
1. Backend + CMS 优先：先稳定 `/api/v1`、React CMS、新 Nexus 分页和管理端闭环，不继续扩大 RN / 小程序迁移范围。
2. 通知闭环优先：ClawDBot / 飞书 webhook adapter、飞书应用 provider、pending 投递调度、`primary_then_fallback` 备用渠道、投递记录与失败信息。
3. 管理端闭环：日程源、个人事项、提醒规则、提醒候选、通知渠道、投递记录、导入中心、审计日志。
4. 导入闭环：新导入中心可上传 PDF 到旧队列，再转换为候选事件；候选可修正、接受 / 拒绝，并提交到日程源或个人事项。
5. 学生端守底线：Taro 小程序保持账号/学号登录、今日 / 周视图、日程源订阅、个人 Todo 创建 / 编辑 / 完成 / 归档可用。
6. 验证门槛：focused type-check / build / node tests / Wrangler smoke / `git diff --check`。

V1 暂缓：RN 正式版、Taro 全量替换 uni-app、Docker + PostgreSQL + Redis、完整 React CMS 替换旧 Nexus、教务系统 connector、真实图片 OCR 产品化、非日程主线功能扩展。

Backend + CMS + 通知渠道短期任务：

- [x] 落地飞书 provider 配置模型：`webhook_bot` / `tenant_app`、`receiveIdType`、`defaultReceiveId`。
- [x] CMS 通知通道页支持飞书机器人 webhook 与企业自建应用配置。
- [x] 后端飞书 adapter 支持企业自建应用：获取 `tenant_access_token` 后调用飞书消息 API。
- [x] 飞书机器人签名发送支持 timestamp/sign。
- [x] reminder candidate 入队统一使用 channel order 策略，`primary_then_fallback` 先投主通道、失败后生成备用通道 delivery。
- [ ] 飞书应用用户级接收人绑定，不再只依赖全局 `defaultReceiveId`。
- [ ] 通知投递记录增加手动重试单条 failed delivery 的 CMS 操作。
- [ ] 为 `/api/v1/admin/notification-*` 增加 API-level 权限和 adapter 回归测试。
- [ ] 将 `v1-api.ts` 中 notification 路由逐步拆到独立 handler/service。

MVP 快速测试任务：

- [x] 根路径 `/` 改为 CMS 主页面，不再返回 JSON；登录态异常跳 `/nexus/login`；新增 `/api/health` 作为 API 健康检查路径。
- [x] 默认后台管理员账号统一为 `admin@schedule.com`，默认密码重置为 `123456`。

- [x] 新增 ClawDBot + AI 课程交互模拟接口：`POST /api/v1/bot/clawdbot/simulate`。
- [x] 模拟接口支持从自然语言提取日程候选、返回机器人 text reply，并可用 `commit=true` 写入个人日程。
- [x] 模拟接口限制为 localhost，远程调用需 `x-clawdbot-sim-token` / `x-bot-delivery-token`。
- [ ] 给模拟接口增加一个最小 CMS/脚本入口，方便输入消息并查看 reply/candidates。
- [ ] 接入真实 ClawDBot webhook 回调：校验 token / 解析用户 / 调用模拟逻辑 / 返回或推送 reply。
- [ ] 用生产 ClawDBot webhook 做一次真实端到端 smoke。

V1 本地验收证据：

- `apps/miniapp/src` 已无 demo / mock / fallback 样例数据主线，学生端通过 `auth/login`、`auth/me`、`calendar/me/effective`、`calendar/sources`、`calendar/me/personal-events` 读取真实 API。
- `auth/login` 和 `auth/me` 返回真实登录模式（新账号为 `account_password`，旧学号兼容为 `legacy_student_no`），不再把新 Taro 登录标记为 mock 模式。
- `apps/backend/server/services/notification-delivery-module.test.mjs` 使用本地 loopback HTTP server 验证 ClawDBot webhook adapter 的真实 HTTP POST。
- `apps/backend/scripts/smoke-local.sh` 覆盖 `/health`、`/api/v1`、`/nexus/login`、`/nexus/preview`；设置 `SMOKE_STUDENT_NO_LOGIN` 时验证 `auth/login` + `auth/me` 的 legacy 学号兼容登录模式；设置 `SMOKE_SCHEDULE_IMPORT_STUDENT_NO` 时上传伪 PDF 验证导入队列终态与结构化错误。
- 最近通过的本地 gate：backend type-check / build、cms type-check / build、miniapp type-check / build:weapp、calendar-core tests、后端 focused node tests、V1 相关 `git diff --check`。

上线前环境验收：

- 使用生产 ClawDBot 或飞书 webhook 配置做一次真实外部投递 smoke。
- 使用真实 PDF 课表样本验证解析质量，而不是只验证伪 PDF 的队列和错误终态。
- 复核生产管理员密码、学生学号登录策略和 Cloudflare D1/R2/Queue binding。
