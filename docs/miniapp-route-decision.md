# Miniapp Route Decision

Date: 2026-06-01

## Decision

Use `apps/miniapp` as the forward route for the student schedule experience. Keep `apps/microapp` as the stable production reference until the Taro route reaches feature parity for the core schedule, profile, import, notification, and social entry points.

Do not archive or replace `apps/microapp` during V1 closeout. The replacement decision should happen only after the parity gates below are met and verified.

## Evidence

| Area | `apps/microapp` | `apps/miniapp` | Decision impact |
| --- | --- | --- | --- |
| Framework | uni-app + Vue | Taro + React | Taro matches the new React/RN/shared-package direction. |
| WeChat build | `pnpm --filter @touchx/microapp build:mp-weixin` passes | `pnpm --filter @touchx/miniapp build:weapp` passes | Both routes are buildable; old route can remain as fallback. |
| Type check | `pnpm --filter @touchx/microapp type-check` passes | `pnpm --filter @touchx/miniapp type-check` passes | Both routes are maintainable at the type level. |
| Package surface | 20 dependencies + 10 devDependencies | 15 dependencies + 4 devDependencies | Taro route has a smaller app-specific package surface. |
| Page scope | 45 page-related files | 8 page-related files | Taro route is not yet feature-complete enough to replace uni-app. |
| Source size | 31,570 lines under `src` | 2,662 lines under `src` | Taro route is simpler, but still a partial rebuild. |
| WeChat output size | about 2.0 MB directory / 1,598,120 bytes counted files | about 416 KB directory / 351,084 bytes counted files | Taro route is currently much lighter for the implemented subset. |
| API layer | local uni-app request utilities | `@touchx/api-client` with Taro adapter | Taro route is aligned with the shared API client direction. |
| UI parity | mature schedule/profile/social/game surface | today/week/sources/profile first pass | Keep uni-app until core user flows are fully covered in Taro. |

## Parity Gates

Before replacing or archiving `apps/microapp`, `apps/miniapp` must pass these gates:

1. Today and week schedule flows use real Calendar API data and keep empty, loading, error, unauthenticated, and authenticated states guarded by `pnpm --filter @touchx/backend smoke:miniapp-parity`.
2. Profile account, notification binding, PDF import, and custom calendar-source publishing are available through real API calls and are guarded by `pnpm --filter @touchx/backend smoke:miniapp-parity`.
3. Existing microapp routes have a Taro equivalent or an explicit V1 defer decision in the route coverage matrix below, guarded by `pnpm --filter @touchx/backend smoke:miniapp-parity`.
4. `pnpm verify:v1-release` passes, covering backend local gate, Taro build, uni-app fallback type-check, and uni-app WeChat build.
5. Manual WeChat DevTools smoke follows `docs/miniapp-wechat-smoke-checklist.md` and covers first load, login, today, week, subscription, profile, PDF import, notification binding, and fallback route check.

## Microapp Route Coverage Matrix

`Covered` means the V1 Taro route has a direct equivalent for the core user outcome. `Partial` means the core outcome has a Taro path but specialized microapp behavior remains a fallback. `Deferred` means the route is intentionally outside the V1 Taro replacement scope and must stay on `apps/microapp` until a later phase.

| Microapp route | V1 decision | Taro equivalent or defer decision |
| --- | --- | --- |
| `pages/index/index` | Covered | Split into `apps/miniapp` tabs: `pages/today/index`, `pages/week/index`, `pages/sources/index`, and `pages/profile/index`. |
| `pages/profile/account` | Covered | `apps/miniapp/src/pages/profile/index.tsx` handles account/password login, registration, refresh, nickname update, and logout. |
| `pages/profile/avatar` | Deferred | Avatar and wallpaper media editing stays in microapp for V1; Taro profile only displays existing avatar state. |
| `pages/profile/student-no` | Deferred | Mandatory student-number editing is legacy behavior; Taro V1 uses account/password auth and shared CalendarSource/PDF flows. |
| `pages/profile/bind-student` | Deferred | Legacy student binding stays in microapp for V1; Taro uses account/password auth and schedule import/subscription flows. |
| `pages/profile/bind-guide` | Deferred | Legacy binding instructions stay with the legacy binding route while Taro avoids the student-number-first flow. |
| `pages/profile/subscribe` | Partial | `pages/sources/index` covers CalendarSource subscribe/cancel; social user subscriptions, inbound requests, circles, and notification inbox stay in microapp for V1. |
| `pages/profile/circle-join` | Deferred | Circle join/social graph management is outside V1 Taro replacement scope. |
| `pages/profile/social-activities` | Deferred | Social activity creation and invitation flows stay in microapp for V1. |
| `pages/profile/ai-assistant` | Deferred | AI assistant remains a microapp/legacy route until shared assistant scope is defined after V1. |
| `pages/profile/exam-companion` | Deferred | Exam companion remains a legacy companion route; Taro V1 only renders effective calendar items. |
| `pages/profile/calendar-views` | Partial | `pages/today/index` and `pages/week/index` cover effective calendar views; specialized categorized views stay in microapp for V1. |
| `pages/profile/free-heatmap` | Deferred | Shared free/busy heatmap is a social feature and remains microapp-only for V1. |
| `pages/profile/preferences` | Partial | `pages/week/index` covers reminder settings; legacy theme/background and broader preferences remain microapp fallback. |
| `pages/profile/schedule-import` | Partial | `pages/profile/index` covers PDF file selection and import preview; editable confirmation and correction workflows remain microapp/admin fallback for V1. |
| `pages/profile/food-campaign` | Deferred | Food campaign flows are outside V1 Taro replacement scope. |
| `pages/profile/food-campaign-detail` | Deferred | Food campaign detail stays in microapp for V1. |
| `pages/profile/food-campaign-create` | Deferred | Food campaign creation stays in microapp for V1. |
| `pages/profile/food-candidate-pool` | Deferred | Food candidate review/pool stays in microapp/admin for V1. |
| `pages/profile/food-campaign-history` | Deferred | Food campaign history stays in microapp for V1. |
| `pages/profile/food-campaign-invitees` | Deferred | Food campaign invitee selection stays in microapp for V1. |
| `pages/party-games/werewolf` | Deferred | Party games are V2/social entertainment scope and stay in microapp. |
| `pages/party-games/undercover` | Deferred | Party games are V2/social entertainment scope and stay in microapp. |
| `pages/party-games/avalon` | Deferred | Party games are V2/social entertainment scope and stay in microapp. |
| `pages/party-games/telephone` | Deferred | Party games are V2/social entertainment scope and stay in microapp. |
| `pages/party-games/drawguess` | Deferred | Party games are V2/social entertainment scope and stay in microapp. |
| `pages/party-games/turtle` | Deferred | Party games are V2/social entertainment scope and stay in microapp. |
| `pages/party-games/heart-open` | Deferred | Party games are V2/social entertainment scope and stay in microapp. |

## Theme And Cross-Platform Fit

`apps/miniapp` should share semantics with React Native and Nexus, but keep a WeChat-native UI layer:

- Use `@touchx/api-client` for all core API calls; do not reintroduce local `/api/v1` wrappers.
- Map colors and event semantics from `packages/ui-tokens`; miniapp page themes and event tones flow through `miniappPageThemeStyles`, while CSS keeps only WeChat layout, spacing, and component limitations.
- Keep schedule, profile, import, notification, and social view-model logic close to shared packages or small app-level hooks; do not port uni-app page internals wholesale.
- Treat `apps/microapp` as a behavior reference, not a visual template. Taro pages should match core states and outcomes while following the current TouchX low-saturation, tokenized theme.

## Replacement Ladder

Replacement should happen in three steps:

1. **Shadow route**: ship `apps/miniapp` for internal testing while `apps/microapp` remains production fallback.
2. **Primary route**: after parity gates pass, new student schedule work lands in `apps/miniapp`; `apps/microapp` only receives critical production fixes.
3. **Archive route**: archive or remove `apps/microapp` only after one release cycle with no critical regression in login, today/week, subscription, import, notification binding, and profile.

## V1 Recommendation

For V1, keep shipping fixes to `apps/microapp` only when needed for production stability. New student schedule work should target `apps/miniapp` and shared packages first, while avoiding feature expansion outside the V1 schedule and notification scope.
