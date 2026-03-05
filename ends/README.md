# ends（企业微信课表提醒）

这个服务使用企业微信自建应用推送，实现：

1. 用户输入姓名自动绑定对应课表
2. 支持上课前 60/30/15/5 分钟提醒（默认 30 + 15）
3. SQLite 去重，避免重复推送
4. 提供一个简单管理页面，方便你管理企业微信鉴权与绑定关系
5. 支持按人设置称呼（如“贤贤提醒您”）
6. 支持按天关闭推送（周一到周日）
7. 支持后端配置推送文案模板

## 管理页面

启动后直接访问：

- `http://127.0.0.1:9986/`（会跳转）
- `http://127.0.0.1:9986/admin/wecom`
- `http://127.0.0.1:9986/admin/users`
- `http://127.0.0.1:9986/admin/themes`
- `http://127.0.0.1:9986/admin/templates`

页面功能：
- 登录鉴权（`/login`，登录后进入管理后台）
- tabs 已升级为二级路由（支持直接访问、刷新保持、浏览器前进后退）
- 企业微信鉴权配置（支持持久化保存与脱敏返显）
- 小程序微信登录配置（支持持久化保存与脱敏返显）
- 统一用户管理表：编辑用户资料 / 企业微信绑定 / 管理员权限
- 新增/编辑用户统一使用弹窗（Dialog）
- 动态新增、编辑、删除（内置用户仅允许编辑）
- 用户列表 CSV 在线查看与保存（默认文件：`src/data/normalized/users.normalized.csv`）
- 按用户编辑课程 CSV（`courses.normalized.csv`）并即时生效
- 支持导出全部或单用户 CSV（用户列表/课程）
- 编辑“正式提醒/测试提醒”标题和正文模板

默认正式标题示例：

- `贤贤提醒您，30 分钟后即将上课`
- `课程：{course_name}{classroom_suffix}`

## 环境变量

- `PUSH_MODE`：`wecom` / `mock`（默认 `wecom`）
- `ADMIN_WEB_AUTH_TOKEN`：云端网页管理登录 token（必填）
- `ADMIN_WEB_SESSION_TTL_SECONDS`：网页登录会话有效期秒数（默认 `43200`）
- `WECOM_API_BASE`：企业微信 API 域名（默认 `https://qyapi.weixin.qq.com`）
- `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_CORP_SECRET`：企业微信应用配置（可在管理页覆盖）
- `WECOM_DEFAULT_TOUSER`：企业微信默认接收人（默认空，必须显式配置）
- `WECOM_CALLBACK_TOKEN` / `WECOM_CALLBACK_AES_KEY`：企业微信“接收消息”URL 验证用参数（来自应用配置）
- `MP_WECHAT_APPID` / `MP_WECHAT_SECRET`：小程序微信登录配置（`/api/auth/wechat-login` 必填）
- `TOUCHX_DB_PATH`：SQLite 文件路径（默认 `ends/app/touchx.db`）
- `COURSE_CSV_PATH`：课程 CSV 路径（默认 `src/data/normalized/courses.normalized.csv`）
- `USER_CSV_PATH`：用户列表 CSV 路径（默认 `src/data/normalized/users.normalized.csv`）
- `TERM_WEEK1_MONDAY`：第 1 周周一（默认 `2026-03-02`）
- `TOUCHX_TIMEZONE`：默认 `Asia/Shanghai`
- `ENABLE_REMINDER_WORKER`：`1/0`，是否开启后台扫描（默认 `1`）
- `REMINDER_SCAN_INTERVAL_SECONDS`：扫描间隔秒（默认 `60`）
- `REMINDER_TRIGGER_WINDOW_SECONDS`：触发窗口秒（默认 `120`）

## 本地运行

```bash
cd ends
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 9986
```

## 一键脚本（推荐）

你可以只用一个脚本管理：

```bash
cd ends
./reminder --help
```

服务启动也可以直接：

```bash
cd ends
./start.sh
```

默认访问地址：`http://127.0.0.1:9986/`

`start.sh` 会自动加载 `ends/.env`（如果存在）。
`reminder` 脚本也会自动加载 `ends/.env`（如果存在）。

建议 `.env` 示例：

```bash
ADMIN_WEB_AUTH_TOKEN=please-change-this-token
ADMIN_WEB_SESSION_TTL_SECONDS=43200
PUSH_MODE=wecom
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000002
WECOM_CORP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
WECOM_DEFAULT_TOUSER=zhangsan
WECOM_CALLBACK_TOKEN=touchx-token
WECOM_CALLBACK_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MP_WECHAT_APPID=wx1234567890abcdef
MP_WECHAT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> 说明：后端已禁用 mock 登录，未配置 `MP_WECHAT_APPID/MP_WECHAT_SECRET` 时，`/api/auth/wechat-login` 会直接返回配置错误。

常用命令：

```bash
# 启动服务
./reminder serve --reload

# 给某个人配置企业微信接收人
./reminder set --name 蔡子菱 --userid zhangsan

# 配置称呼 + 关闭周六周日推送
./reminder set --name 唐子贤 --userid lisi --display-name 贤贤 --off-days 6,7

# 测试单人推送
./reminder test --name 蔡子菱

# 查看当前配置
./reminder list
```

## Docker 运行

```bash
cd ends
docker build -t touchx-ends:dev .
docker run --rm -p 9986:9986 \
  -e PUSH_MODE=wecom \
  -e WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx \
  -e WECOM_AGENT_ID=1000002 \
  -e WECOM_CORP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx \
  -e WECOM_DEFAULT_TOUSER=zhangsan \
  touchx-ends:dev
```

## 主要接口

- `GET /health`
- `GET /login`：管理后台登录页
- `POST /api/admin/login`：管理员登录（body: `{ "token": "..." }`）
- `POST /api/admin/logout`：管理员退出登录
- `GET /api/admin/users`：用户列表（含管理员状态、企业微信绑定信息）
- `POST /api/admin/users`：新增用户
- `PUT /api/admin/users/{student_id}`：编辑用户信息
- `DELETE /api/admin/users/{student_id}`：删除用户（仅非内置）
- `GET /api/admin/users/csv`：读取用户列表 CSV（可选 `student_id` 导出单用户）
- `POST /api/admin/users/csv`：保存用户列表 CSV
- `GET /api/admin/courses/csv`：读取课程 CSV（可选 `student_id` 导出单用户；不传则全部）
- `POST /api/admin/courses/csv`：保存指定用户课程 CSV 内容
- `GET /api/schedules`：查看可绑定姓名
- `POST /api/subscribers/register`：注册/更新订阅
- `POST /api/subscribers/active`：启用/停用订阅
- `POST /api/subscribers/test`：发送单人测试推送
- `GET /api/subscribers`：查看订阅列表
- `GET /api/settings/templates`：获取文案模板
- `POST /api/settings/templates`：更新文案模板
- `GET /api/settings/wecom`：获取企业微信配置状态
- `POST /api/settings/wecom`：保存企业微信配置
- `POST /api/settings/wecom/test`：测试企业微信鉴权连接
- `GET /api/settings/mini-program`：获取小程序登录配置状态
- `POST /api/settings/mini-program`：保存小程序登录配置
- `POST /api/settings/mini-program/test`：测试小程序 `app_id/app_secret` 连通性（会返回微信错误码）
- `GET /api/wecom/bindings`：查看企业微信已绑定用户列表
- `GET /api/wecom/callback`：企业微信 URL 验证入口（返回解密明文）
- `POST /api/wecom/callback`：企业微信消息回调入口（支持 help/bind/sub/test 等文本命令）
- `GET /api/social/me`：获取当前用户社交面板（我的信息 / 我的订阅 / 订阅我的人 / 广场）
- `POST /api/social/bind-student`：登录后绑定课表账号（`target_student_id`）
- `GET /api/schedules/student?student_id=xxx`：登录后按人拉取单人课表
- `POST /api/social/subscribe`：按 `target_student_id` 直接订阅（仅允许对方已注册）
- `POST /api/social/subscribe/remove`：取消订阅
- `POST /api/social/upload/avatar`：上传头像（最大 2MB，临时云端存储）
- `POST /api/social/upload/wallpaper`：上传壁纸（最大 5MB，临时云端存储）
- `GET /api/media/{file_name}`：访问临时图片资源

企业微信配置说明：
- 管理页保存后会自动写入 SQLite（`app_settings`），重启后仍生效
- 读取优先级：管理页保存值 > `.env` 环境变量默认值
- 第一次保存必须填写 `corp_secret`
- 后续仅改 `corp_id/agent_id` 时，`corp_secret` 可留空沿用旧值
- `default_touser` 必填（用于企业微信发送目标）
- `callback_token` 与 `callback_aes_key` 要么都填，要么都不填
- 企业微信“接收消息服务器地址”请填：`https://你的域名/api/wecom/callback`
- 用户命令：
  - `help`：获取菜单
  - `bind 姓名`：绑定课表（如 `bind 唐子贤`）
  - `sub 姓名`：追加订阅他人课表
  - `unsub 姓名`：取消订阅
  - `subs`：查看订阅列表
  - `offsets`：查看提醒档位（60/30/15/5）
  - `offset 分钟 on|off`：开关提醒档位（默认开 30/15）
  - `digest on|off`：开关“每日首节课前30分钟总览”
  - `test [姓名]`：发送测试推送
- 管理页可查看绑定用户列表并点击“测试推送”模拟发送

## 注册接口示例

### 用企业微信用户ID（推荐）

```bash
curl -X POST http://127.0.0.1:9986/api/subscribers/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "蔡子菱",
    "channel_token": "zhangsan",
    "subscriber_key": "student-caiziling",
    "display_name": "子菱",
    "disabled_days": [6, 7]
  }'
```

> `channel_token` 会自动规范为：`wecom://<userid>`

### 用完整通道标识

```bash
curl -X POST http://127.0.0.1:9986/api/subscribers/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "蔡子菱",
    "channel_url": "wecom://zhangsan"
  }'
```

## 说明

- 伍鑫宇课表已按要求与蔡子菱一致。
- 周次计算以 `TERM_WEEK1_MONDAY=2026-03-02` 为第 1 周周一。
- 如果需要先联通企业微信，先在 `/admin` 页面填写企业微信参数，再点击“测试连接”。
