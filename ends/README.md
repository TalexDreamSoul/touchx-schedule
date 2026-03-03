# ends（第三方推送课表提醒）

这个服务使用第三方推送通道（xizhi / 企业微信自建应用），实现：

1. 用户输入姓名自动绑定对应课表
2. 上课前 30 分钟 + 15 分钟双提醒
3. SQLite 去重，避免重复推送
4. 提供一个简单管理页面，方便你给每个人单独配置 token
5. 支持按人设置称呼（如“贤贤提醒您”）
6. 支持按天关闭推送（周一到周日）
7. 支持后端配置推送文案模板

## 管理页面

启动后直接访问：

- `http://127.0.0.1:9986/`
- 或 `http://127.0.0.1:9986/admin`

页面功能：
- 每个学生一行，单独填 token（或完整 channel URL）
- 可设置每个人的推送称呼
- 可勾选关闭某些星期的推送
- 保存配置
- 启用/停用
- 单人测试推送
- 手动执行一次提醒扫描
- 页面内可直接编辑“正式提醒/测试提醒”标题和正文模板
- 可配置企业微信 `corp_id / agent_id / corp_secret` 并测试鉴权连接

默认正式标题示例：

- `贤贤提醒您，30 分钟后即将上课`

## 推送接口约定

参考你给的页面：支持 GET/POST，参数：

- `title`（必需）
- `content`（可选）

当前实现默认用 `POST form-urlencoded` 发送到通道 URL。

## 环境变量

- `PUSH_MODE`：`xizhi` / `wecom` / `mock`（默认 `xizhi`）
- `XIZHI_DEFAULT_CHANNEL_URL`：默认推送通道 URL（可选，未配置时注册必须传 token/url）
- `WECOM_API_BASE`：企业微信 API 域名（默认 `https://qyapi.weixin.qq.com`）
- `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_CORP_SECRET`：企业微信应用配置（可在管理页覆盖）
- `WECOM_DEFAULT_TOUSER`：企业微信默认接收人（默认空，必须显式配置）
- `WECOM_CALLBACK_TOKEN` / `WECOM_CALLBACK_AES_KEY`：企业微信“接收消息”URL 验证用参数（来自应用配置）
- `TOUCHX_DB_PATH`：SQLite 文件路径（默认 `ends/app/touchx.db`）
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
PUSH_MODE=wecom
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000002
WECOM_CORP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
WECOM_DEFAULT_TOUSER=zhangsan
WECOM_CALLBACK_TOKEN=touchx-token
WECOM_CALLBACK_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

常用命令：

```bash
# 启动服务
./reminder serve --reload

# 给某个人配置 token
./reminder set --name 蔡子菱 --token XZ361b4be146a2fbfad9cdae4436903831

# 配置称呼 + 关闭周六周日推送
./reminder set --name 唐子贤 --token XZxxxx --display-name 贤贤 --off-days 6,7

# 测试单人推送
./reminder test --name 蔡子菱

# 手动跑一轮提醒
./reminder run-once

# 查看当前配置
./reminder list
```

## Docker 运行

```bash
cd ends
docker build -t touchx-ends:dev .
docker run --rm -p 9986:9986 \
  -e PUSH_MODE=xizhi \
  -e XIZHI_DEFAULT_CHANNEL_URL="https://xizhi.qqoq.net/xxxx.channel" \
  touchx-ends:dev
```

## 主要接口

- `GET /health`
- `GET /api/schedules`：查看可绑定姓名
- `POST /api/subscribers/register`：注册/更新订阅
- `POST /api/subscribers/active`：启用/停用订阅
- `POST /api/subscribers/test`：发送单人测试推送
- `GET /api/subscribers`：查看订阅列表
- `POST /api/reminders/run-once`：手动跑一轮提醒
- `GET /api/settings/templates`：获取文案模板
- `POST /api/settings/templates`：更新文案模板
- `GET /api/settings/wecom`：获取企业微信配置状态
- `POST /api/settings/wecom`：保存企业微信配置
- `POST /api/settings/wecom/test`：测试企业微信鉴权连接
- `GET /api/wecom/bindings`：查看企业微信已绑定用户列表
- `GET /api/wecom/callback`：企业微信 URL 验证入口（返回解密明文）
- `POST /api/wecom/callback`：企业微信消息回调入口（支持 help/bind/test 文本命令）

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
  - `test`：发送测试推送
- 管理页可查看绑定用户列表并点击“测试推送”模拟发送

## 注册接口示例

### 用 token（推荐）

```bash
curl -X POST http://127.0.0.1:9986/api/subscribers/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "蔡子菱",
    "channel_token": "XZ361b4be146a2fbfad9cdae4436903831",
    "subscriber_key": "student-caiziling",
    "display_name": "子菱",
    "disabled_days": [6, 7]
  }'
```

> `channel_token` 会自动拼接成：`https://xizhi.qqoq.net/<token>.channel`

### 用完整 URL

```bash
curl -X POST http://127.0.0.1:9986/api/subscribers/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "蔡子菱",
    "channel_url": "https://xizhi.qqoq.net/你的密钥.channel"
  }'
```

## 说明

- 伍鑫宇课表已按要求与蔡子菱一致。
- 周次计算以 `TERM_WEEK1_MONDAY=2026-03-02` 为第 1 周周一。
- 如果需要先联通企业微信，先在 `/admin` 页面填写企业微信参数，再点击“测试连接”。
