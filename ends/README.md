# ends（第三方推送课表提醒）

这个服务使用第三方推送通道（如 xizhi），实现：

1. 用户输入姓名自动绑定对应课表
2. 上课前 30 分钟 + 15 分钟双提醒
3. SQLite 去重，避免重复推送
4. 提供一个简单管理页面，方便你给每个人单独配置 token
5. 支持按人设置称呼（如“贤贤提醒您”）
6. 支持按天关闭推送（周一到周日）
7. 支持后端配置推送文案模板

## 管理页面

启动后直接访问：

- `http://127.0.0.1:8080/`
- 或 `http://127.0.0.1:8080/admin`

页面功能：
- 每个学生一行，单独填 token（或完整 channel URL）
- 可设置每个人的推送称呼
- 可勾选关闭某些星期的推送
- 保存配置
- 启用/停用
- 单人测试推送
- 手动执行一次提醒扫描
- 页面内可直接编辑“正式提醒/测试提醒”标题和正文模板

默认正式标题示例：

- `贤贤提醒您，30 分钟后即将上课`

## 推送接口约定

参考你给的页面：支持 GET/POST，参数：

- `title`（必需）
- `content`（可选）

当前实现默认用 `POST form-urlencoded` 发送到通道 URL。

## 环境变量

- `PUSH_MODE`：`xizhi` 或 `mock`（默认 `xizhi`）
- `XIZHI_DEFAULT_CHANNEL_URL`：默认推送通道 URL（可选，未配置时注册必须传 token/url）
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
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
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

默认访问地址：`http://127.0.0.1:8080/`

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
docker run --rm -p 8000:8000 \
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

## 注册接口示例

### 用 token（推荐）

```bash
curl -X POST http://127.0.0.1:8080/api/subscribers/register \
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
curl -X POST http://127.0.0.1:8080/api/subscribers/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "蔡子菱",
    "channel_url": "https://xizhi.qqoq.net/你的密钥.channel"
  }'
```

## 说明

- 伍鑫宇课表已按要求与蔡子菱一致。
- 周次计算以 `TERM_WEEK1_MONDAY=2026-03-02` 为第 1 周周一。
