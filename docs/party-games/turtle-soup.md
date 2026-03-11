# 海龟汤（速推理）多人同步策划

## 目标与定位
- 6~10 人推理讨论，单局 20~30 分钟。
- 适配“快节奏问答 + 限量提问”场景。
- 必须多人在线同步，不做离线单机。

## 人数与角色
- 推荐人数：6~10。
- 角色：1 名出题者（可轮换），其余为推理者。
- 题型：标准海龟汤（可回答“是/否/无关”）。

## 核心规则
- 出题者提交题面与标准答案（私密）。
- 推理者轮流提问，出题者只能回复“是/否/无关”。
- 限制总提问次数或总时长，结束前可发起终局猜测。
- 猜中即挑战者胜；超时未猜中则出题者胜。

## 房间状态机
- `waiting`
- `setup_story`
- `qna_round`
- `final_guess`
- `solution_reveal`
- `finished`

## 实时同步设计
### 客户端动作
- `turtle.story.submit`
- `turtle.question.ask`
- `turtle.answer.reply`
- `turtle.final-guess.submit`

### 服务端事件
- `turtle.private.story-confirmed`（出题者单播）
- `turtle.question.accepted`
- `turtle.answer.published`
- `turtle.final-guess.result`
- `turtle.solution.revealed`
- `game.finished`

### 同步要点
- 标准答案全程仅出题者与服务端可见，直到揭晓。
- 提问队列服务端排队，防并发抢问。
- 问答记录按序号持久化，支持复盘。

## 服务端职责与接口
- 验证问题频率、违规内容、重复提问。
- 维护 `questionBudget`、`questionQueue`、`answerLog`。
- 关键接口：
  - `POST /api/v1/party-games/rooms/{roomId}/actions`
  - `GET /api/v1/party-games/rooms/{roomId}/qna-log`

## 客户端交互流程
- 房间页：选择题包、提问预算、回合时长。
- 对局页：
  - 左侧问答流。
  - 右侧排队区与抢问按钮。
  - 底部终局猜测入口。
- 结算页：完整答案 + 高质量提问榜。

## 风险与反作弊
- 出题者改答案：开局后答案上链式哈希存证（至少做本局不可改校验）。
- 恶意刷问：每人冷却时间和总次数限制。
- 并发冲突：服务端按时间戳与队列顺序接纳问题。

## MVP 与迭代
- MVP：标准问答、限时、终局猜测。
- V2：题库管理、难度分层、主持模板。
- V3：AI 辅助出题与自动质量评分。
