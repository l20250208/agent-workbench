# Trace · Agent 任务执行工作台

参考 [langchain-ai/agent-chat-ui](https://github.com/langchain-ai/agent-chat-ui) 的会话和工具结果交互设计，独立实现三栏界面与真实工具执行后端。没有预填会话、模拟进度或伪造运行事件。不依赖 LangGraph 服务，不是该项目的直接 fork。

## 运行

需要 Node.js 22.13 或更新版本，无 npm 依赖需要安装。

```sh
cd /path/to/agent-workbench
cp .env.example .env
npm start
```

打开 http://127.0.0.1:4317 。默认仅监听本机，不是公网多租户部署。

在 `.env` 设置 `LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL` 后重启，即可在界面选择「模型 Agent」。后端通过兼容 OpenAI Chat Completions 的接口调用真实模型。模型需支持 tools / tool_choice / max_completion_tokens；可配置支持这些参数的其他供应商。密钥只存在服务端，不写入日志、不返回浏览器。不要将 .env 提交到版本库。

未配置密钥时可使用「本地工具模式」执行真实命令。这是明确标注的确定性工具执行器，不冒充模型 Agent，也不生成模型 Token 数字。

```text
计算 (1280 * 3) * 0.85
读取 https://example.com
```

每行一个命令，一次最多 8 个。支持 + - * / % ^ 与括号；^ 表示乘方。单个表达式最多 500 字符。

## 已实现

- 左侧任务会话、搜索与新建；中间对话、执行计划、结果、确认与错误；右侧真实事件时间线及筛选。
- 模型 Agent：先调用 create_plan，再自主调用 calculator / read_web，将工具结果返回模型继续决策，最多 12 轮。计划为面向用户的行动清单，不展示模型私有思维链。
- SQLite WAL 持久化运行、工具参数/结果、重试次数、确认决定、模型对话上下文与 Token 用量。每个事件和对应状态在同一事务提交。
- SSE 推送数据库已提交事件的更新通知，客户端读取完整快照；断线重连自动补齐已持久化事件，不依赖浏览器内存。
- 网页读取必须人工确认；计算器确认可选。批准绑定具体运行及工具调用 ID，重复、错误或过期确认返回 409。拒绝直接终止任务。
- 单步重试从持久化 cursor 继续，已完成工具不重复运行；失败的网页或需确认工具必须重新批准。原始失败日志永久保留。
- 重启后 waiting 状态保留；running 状态标记 interrupted，可手动重试。网络调用跨进程崩溃不能保证恰好一次，但工具仅执行计算与公开网页 GET。
- Token 统计来自供应商 usage，显示输入、输出、总量。不估算字符数冒充 Token；无 usage 时显示「—」，部分请求缺失时标注未知。
- JSON 导出当前运行及完整事件。浏览器刷新后保持所选运行。

## 网页读取控制

`ALLOWED_WEB_HOSTS` 是逗号分隔的精确域名白名单；不自动允许子域名。仅 HTTPS、443 端口、无 URL 用户名密码、无 IP 字面量。解析 IPv4 并拒绝非公网地址，将校验后的地址固定给 TLS 请求以防 DNS 重绑定；IPv6 不使用。禁止重定向，只接受 HTML / plain text，下载上限 500 KB，文本输出上限 16,000 字符，socket 超时 12 秒。页面脚本不会执行，网页文本以转义的纯文本展示。模型系统消息明确要求把网页当作不可信数据，工具执行仍受服务端白名单和确认门控约束。

这是本机单用户工作台。公开部署前需增加用户鉴权、按用户隔离数据库、HTTPS、配额、审计访问控制和多进程任务锁。本实现通过 Host 和 Origin 校验阻止外部站点访问本地写接口，默认不支持远程访问。

## API

| 路径 | 用途 |
| --- | --- |
| GET /api/config | 模型配置状态和白名单，无密钥 |
| GET /api/runs | 最近 200 条运行 |
| POST /api/runs | prompt, mode, confirmTools, 可选 parentId |
| GET /api/runs/:id | 运行快照 |
| GET /api/runs/:id/events | 有序原始事件 |
| POST /api/runs/:id/approve | stepId，确认当前工具 |
| POST /api/runs/:id/reject | stepId，拒绝当前工具 |
| POST /api/runs/:id/retry | 可选 stepId，仅重试当前失败/中断步骤 |
| GET /api/events | SSE 更新通知 |

数据默认在 `data/runs.sqlite`，可通过 `DATA_DIR` 修改。备份时停止服务后复制整个 data 目录。展示的最多 200 条记录不代表删除旧记录；数据库继续保留全部事件。

## 验证

```sh
npm test
```

六组自动测试覆盖算术边界、SSRF 策略、真实工具执行、人工确认与拒绝、重复确认、单步重试、不重跑成功步骤、重启持久化、跨源请求拦截、SSE，以及模型工具协议和 usage 累计。模型协议测试使用隔离的 HTTP 测试桩和临时数据库，不写入工作台运行记录，不代表真实云模型端到端验证。

浏览器中实际执行了折扣计算，并通过确认操作读取 example.com。开发验证产生的真实运行保留在本地数据库，包括修复前的失败及重试事件。源码压缩包不包含数据库或密钥。
