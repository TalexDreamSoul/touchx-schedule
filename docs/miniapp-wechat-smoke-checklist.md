# Miniapp WeChat DevTools Smoke Checklist

Use this checklist before switching `apps/miniapp` from shadow route to primary route, or before archiving `apps/microapp`.

## Prerequisites

- Run `pnpm verify:v1-release` successfully.
- Open `apps/miniapp/dist` in WeChat DevTools after `pnpm --filter @touchx/miniapp build:weapp`.
- Open `apps/microapp/dist/build/mp-weixin` in WeChat DevTools after `pnpm --filter @touchx/microapp build:mp-weixin` when validating the fallback route from a fresh local build.
- Use a backend environment that can register/login a test account and read/write calendar data.
- Keep `apps/microapp` available as fallback during the same test window.

## Required Manual Scenarios

| Scenario | Steps | Pass criteria |
| --- | --- | --- |
| First load | Open the miniapp without a session. | Today, week, sources, and profile tabs render without blank screens or console errors. |
| Login and profile | Register or log in with account/password, refresh profile, edit nickname, then log out and log back in. | Session persists across tabs; nickname update is reflected; logout clears local user state. |
| Today schedule | Open Today before and after login, refresh, create a Todo, mark it done, and archive another Todo. | Unauthenticated, loading, empty, and authenticated states are understandable; Todo changes survive refresh. |
| Week schedule | Open Week, switch weeks, switch timeline/course modes, pull to refresh, edit reminder settings. | Calendar events remain aligned to week/weekday/section; settings save without blocking refresh. |
| Subscription and sources | Open Sources, refresh public sources, subscribe/cancel where available, publish a custom source. | Published source appears in the list; subscribed state updates; week/today can read the resulting effective calendar. |
| PDF import preview | In Profile, choose a PDF and run import preview. | Upload returns candidate rows; first preview rows render with course name, day, section, and classroom. |
| Notification binding | In Profile, create a WeChat ClawDBot binding QR, refresh binding state, then unbind if a binding exists. | QR or binding state is visible; unbind clears active state without stale UI. |
| Fallback route check | Open the same account in `apps/microapp` after the miniapp smoke. | Existing production fallback still opens and can show core schedule/profile data. |

## Evidence To Record

- Date, tester, backend environment, and commit/branch identifier.
- `pnpm verify:v1-release` terminal result.
- WeChat DevTools screenshots for Today, Week, Sources, Profile, PDF preview, notification binding, and fallback route check.
- Any failed scenario with observed error message and whether `apps/microapp` fallback still works.

## Decision Rule

Do not archive or replace `apps/microapp` unless every required manual scenario passes in the same release-candidate window.
