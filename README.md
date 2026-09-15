# Atoms Demo · 一句话生成可运行的小应用

- **在线体验**：https://atoms-demo.lyang214674.workers.dev
- **源码**：https://github.com/lyang214674/atoms-demo
- **技术栈**：React + Vite + Tailwind · Hono on Cloudflare Workers · D1 (SQLite) · Workers AI (Gemma 4 26B)

用一句话描述想法，三个智能体（**Planner → Builder → Reviewer**）协作生成一个可运行的单文件网页应用，在页面里实时预览。每次生成存为一个版本，可以继续对话迭代、回看历史版本；一键生成公开分享链接，其他人可以直接运行并 **Remix** 成自己的项目继续改。

---

## 1. 三分钟评测指引

1. 打开 https://atoms-demo.lyang214674.workers.dev ，在首页输入需求（或点一个示例），例：`做一个番茄钟，可以设置专注时长，记录今天完成了几个番茄`
2. 用任意邮箱 + 6 位以上密码**自助注册**（无验证码、不发邮件，随便填即可）
3. 进入工作台后 **Planner** 自动开始拆解需求（约 15s），产出功能清单 / 页面结构 / 数据模型，可以直接编辑，然后点「确认计划，开始构建」
4. **Builder** 流式输出代码（Gemma 4 约 60–90s，左侧可看到实时字符流），完成后右侧沙箱 iframe 立刻运行；**Reviewer** 随后逐项检查并给出结论
5. 在底部输入框继续说「加一个深色模式」→ 生成 v2；左侧版本列表可切换回 v1 对比
6. 点右上「分享」→ 得到 `/s/<slug>` 公开链接；用另一个浏览器 / 账号打开，可直接运行，也可点「Remix」复制到自己账号继续迭代；首页「作品墙」展示所有公开项目

> 额度说明：线上模型走 Cloudflare Workers AI 免费档。每账号每天 10 次生成、全站每天 30 次；失败不扣次数。如果遇到「额度已用完」，请第二天再试或按第 6 节自行部署。

---

## 2. 与题目要求的对应

| 要求 | 实现 |
|---|---|
| 智能体驱动的代码（应用）生成 | Planner / Builder / Reviewer 三角色流水线，中间产物落库、事件可回放，Planner 结果需人工确认后才构建 |
| 生成的应用以可视化网页形式展示 | 沙箱 iframe 实时预览（桌面 / 手机宽度切换、全屏、新标签打开），`/raw/*` 独立路径输出原始 HTML |
| 真实交互（非静态） | SSE 流式输出、计划可编辑、对话式迭代、版本切换、分享 / 取消分享、Remix |
| 数据持久化 | D1：用户、会话、项目、版本（计划 / HTML / 审查结果）、Agent 事件、每日用量 |
| 基本使用流程（注册 / 核心主流程） | 邮箱密码自助注册 → 输入需求 → 规划 → 构建 → 预览 → 迭代 |
| 至少一个延展能力 | 公开分享页 + Remix + 作品墙；多版本历史；Reviewer 审查报告 |
| 可测试的在线链接 | Cloudflare Workers 部署，无需任何测试账号 |
| 实际可用而非 PoC | 完整错误处理、失败重试与配额退回、空态、每日限流、CSP 隔离生成物 |

---

## 3. 实现思路

### 3.1 架构

```
Browser (React + Vite + Tailwind)
   │  fetch / SSE
Cloudflare Worker (Hono)
   ├─ /api/auth/*               注册 / 登录 / 会话（PBKDF2 + HttpOnly Cookie）
   ├─ /api/projects/*           项目、版本、迭代、分享
   ├─ /api/versions/:id/plan    Planner              (SSE)
   ├─ /api/versions/:id/build   Builder + Reviewer   (SSE)
   ├─ /api/share/:slug  /api/remix/:slug  /api/gallery   公开能力
   ├─ /raw/*                    生成物原始 HTML（CSP sandbox，隔离源）
   └─ 其余路径 → 静态资源（SPA）
D1 (SQLite)   users / sessions / projects / versions / agent_events / usage_daily
Workers AI    @cf/google/gemma-4-26b-a4b-it（可切换任意 OpenAI 兼容接口）
```

### 3.2 Agent 流水线

三个角色是三次带不同系统提示词的模型调用，共享同一份结构化「计划」作为上下文：

- **Planner**（temperature 0.3）：把一句话需求拆成 `app_name / summary / features / sections / data_model / style` 的 JSON。用户可编辑后确认——对应 Atoms 里「Team Leader 在关键节点等人批准」的思路，也避免模型理解偏了之后白跑一次昂贵的构建。
- **Builder**（temperature 0.4）：依据计划生成完整单文件 HTML，约束为 Tailwind CDN + 原生 JS + localStorage 持久化，文件体积有硬预算，防止长输出被截断。迭代时把上一版 HTML 与用户的修改意见一起给它，产出新版本而不是覆盖。
- **Reviewer**：先做确定性的**静态检查**（文档完整、含 `<script>`、用了 localStorage、无白名单外的外部脚本），再让模型对照计划逐条验收功能覆盖、空态、响应式，输出 `pass / warn` 与逐项 `checks`。模型审查失败不影响主流程，静态检查结果始终保留。

所有 token 流经 Worker 直接转发给浏览器（SSE），中间产物（计划、HTML、审查、每步 start/done/error 事件）全部写入 D1，刷新页面可恢复，`agent_events` 可回放。

### 3.3 生成物的安全运行

生成的 HTML 是不可信代码。预览用 `iframe sandbox="allow-scripts allow-forms allow-modals allow-popups"`（不给 `allow-same-origin`），`/raw/*` 响应再加一层 `Content-Security-Policy: sandbox`，因此生成物拿不到访问者的 Cookie，也不能以站点源身份发请求。

### 3.4 成本与稳定性护栏

- 线上默认用 **Cloudflare Workers AI**：与 Worker 同平台、无地区限制、无需 API Key、每天 10,000 neurons 免费；一次完整生成（规划 + 构建 + 审查）约 300 neurons
- 每用户每日上限 10 次 + 全站每日上限 30 次；**构建失败自动退回配额**
- 429 / 503 自动退避重试（1.5s / 4s / 8s）；错误信息对用户友好化并落库
- `LLM_PROVIDER=openai` 可一键切到任意 OpenAI 兼容接口（Gemini / DeepSeek / OpenAI），Key 只存服务端 Secret

---

## 4. 关键取舍

| 选择 | 放弃 | 原因 |
|---|---|---|
| 单文件 HTML 产物 | 多文件 React 工程 + 打包 | 8 小时内稳定跑通；无构建链即可预览；Reviewer 静态检查也简单 |
| 三个顺序角色 + 人工确认门 | Agent 框架、更多专职角色 | 已体现「智能体驱动」与「人在回路」；更多角色本质是更多提示词，收益递减 |
| Workers AI（Gemma 4 26B） | Gemini 免费档 | Worker 在离访问者最近的节点出网，Gemini 对部分地区返回 `User location is not supported`；Workers AI 无此问题、无需 Key。代价是生成慢（约 90s vs 40s）、代码略保守 |
| Cookie + D1 会话 | KV | Workers 免费档 KV 每日仅 1000 次写 |
| PBKDF2（WebCrypto） | bcrypt | Workers 免费档单请求 10ms CPU |
| 邮箱密码自助注册 | 邮件验证码 / OAuth | 评测最顺畅；Worker 不方便发邮件 |
| Workers + Static Assets | Pages Functions | 一条 `wrangler deploy`；SSE 与 D1 绑定更直接 |
| 每日配额 + 全站上限 | 无限制 | 免费额度有限，宁可让评测人看到明确的「今日额度用完」，也不要静默失败 |

---

## 5. 完成度

**已完成**

- 账号：注册 / 登录 / 登出、HttpOnly 会话
- 生成：创建项目、Planner 规划 + 可编辑确认、Builder 流式生成、Reviewer 静态 + 模型审查
- 预览：沙箱 iframe、桌面 / 手机宽度、全屏、新标签打开原始 HTML
- 迭代：对话式修改生成新版本、版本列表与切换、失败后重新规划 / 重新构建
- 分发：分享 / 取消分享、公开分享页、Remix 到自己账号、首页作品墙
- 工程：每日配额（失败退回）、429/503 重试、空态与错误提示、CSP 隔离、D1 迁移脚本、一条命令部署

**部分完成**

- 版本之间只能切换查看，没有 diff 视图
- Reviewer 只报告问题，不会自动修补
- 模型审查依赖模型返回合法 JSON，Gemma 偶尔只剩静态检查结果

**未做**

- 多文件 / React 工程产物
- 把生成物部署到独立域名
- 可视化编辑器、团队协作、项目重命名

**实测数据**（输入「做一个番茄钟，可以设置专注时长，记录今天完成了几个番茄」）

- Workers AI / Gemma 4 26B：Planner 15s → Builder 88s 生成 12.8K 字符 → 审查通过 → 分享 → 另一账号 Remix 成功
- Gemini 3.5 Flash（本地）：Planner 2s → Builder 42s 生成 28.6K 字符 → Reviewer 11 项全部通过

---

## 6. 如果继续投入

| 优先级 | 事项 | 理由 |
|---|---|---|
| P0 | Reviewer 发现 `warn` 后自动触发一次 Builder 修补，形成「生成 → 审查 → 修补」闭环 | 这是 Agent 流水线最直接的价值放大点，且现有事件模型已支持 |
| P0 | 换更强的代码模型（付费 Workers AI 目录里的 DeepSeek V4 / GLM 5.3，或 Gemini 通过 AI Gateway 出海外节点） | 当前 Gemma 4 是免费档下的折中，产物质量与速度是最大短板 |
| P1 | 版本 diff 与「回滚为新版本」 | 迭代多轮后需要看清每一版改了什么 |
| P1 | 浏览器内 esbuild-wasm，支持多文件 / React / TS 产物 | 从「小工具」走向「真正的应用」 |
| P2 | Race 模式：同一计划并行两个模型，用户挑一个 | 低成本的质量提升，也是 Atoms 风格的亮点交互 |
| P2 | 生成物一键部署到用户自己的 Pages / 自定义域名 | 补齐「从想法到上线」的最后一步 |
| P3 | 项目重命名、标签、搜索；作品墙点赞与排序 | 运营层面的完善 |

---

## 7. 本地运行

```bash
npm install
npx wrangler login                              # 本地 dev 的 AI 绑定也会调用 Workers AI
npx wrangler d1 migrations apply atoms-demo --local
npm run build && npx wrangler dev               # http://localhost:8787
# 或前端热更新：另开终端 npm run dev（Vite 5173，API 代理到 8787）
```

## 8. 部署（Cloudflare 免费档即可）

```bash
npx wrangler login
npx wrangler d1 create atoms-demo               # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler d1 migrations apply atoms-demo --remote
npm run deploy                                  # 输出 https://atoms-demo.<subdomain>.workers.dev
```

- 换模型：改 `wrangler.jsonc` 的 `LLM_MODEL`（Workers AI 目录中不带 `require_workers_paid` 的模型都能在 Free 计划用，如 `@cf/qwen/qwen2.5-coder-32b-instruct`）
- 换供应商：`LLM_PROVIDER=openai` + `LLM_BASE_URL` + `npx wrangler secret put LLM_API_KEY`，例如 DeepSeek `https://api.deepseek.com/v1` + `deepseek-chat`

## 9. 使用的 AI 工具与开发过程

全程在 **Cursor** 中与模型协作完成，约 7 小时：

1. 先分析 Atoms 产品与文档，产出方案文档、任务拆解与取舍表，确定「单文件产物 + 三角色流水线 + Cloudflare 全家桶」
2. 逐文件生成 Worker（Hono 路由、D1 访问层、鉴权、LLM 客户端、提示词）、D1 Schema 与 React 页面
3. 用脚本对 API 做冒烟测试（注册 / 重复注册 / 错误密码 / 未登录 401 / SSE 错误事件），再跑端到端生成
4. 上线后遇到 Gemini 地区限制，切换到 Workers AI 并补上配额退回、错误提示等护栏

人工判断主要集中在：安全边界（sandbox、CSP、Secret）、免费额度约束（KV 写次数、CPU 时间、模型 neurons）、模型选型与评测流程的取舍。
