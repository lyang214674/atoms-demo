# Atoms Demo · 一句话生成可运行的小应用

> 在线体验：`<部署后填写 https://atoms-demo.<你的子域>.workers.dev>`

用一句话描述想法，三个智能体（Planner → Builder → Reviewer）协作生成一个**可运行的单文件网页应用**，在页面里实时预览；每次生成存为版本，可以继续对话迭代、回看历史版本，一键生成公开分享链接，其他人可以直接运行并 **Remix** 成自己的项目。

## 主流程

1. 打开首页，输入需求（例：`做一个番茄钟，记录今天完成了几个番茄`）
2. 邮箱 + 密码自助注册（无验证码），项目保存在账号下
3. **Planner** 把需求拆成功能清单 / 页面结构 / 数据模型，你可以编辑后确认
4. **Builder** 流式生成完整 HTML，右侧沙箱 iframe 立即运行
5. **Reviewer** 逐项检查：功能覆盖、localStorage 持久化、外部脚本白名单、空态、响应式
6. 继续说「加一个深色模式」→ 生成 v2；版本可切换、可全屏打开
7. 点「分享」→ `/s/<slug>` 公开页；访客可运行、可 Remix 到自己账号继续改；首页作品墙展示公开项目

## 架构

```
Browser (React + Vite + Tailwind)
   │  fetch / SSE
Cloudflare Worker (Hono)
   ├─ /api/auth/*          注册 / 登录 / 会话（PBKDF2 + HttpOnly Cookie）
   ├─ /api/projects/*      项目、版本、迭代、分享
   ├─ /api/versions/:id/plan   Planner   (SSE)
   ├─ /api/versions/:id/build  Builder + Reviewer (SSE)
   ├─ /api/share/:slug, /api/remix/:slug, /api/gallery   公开能力
   ├─ /raw/*               生成物原始 HTML（CSP sandbox，隔离源）
   └─ 其余路径 → 静态资源（SPA）
D1 (SQLite)  users / sessions / projects / versions / agent_events / usage_daily
LLM          任意 OpenAI 兼容接口（OpenAI / DeepSeek / Gemini / Groq …）
```

- **Agent 流水线**：三个角色是三次带系统提示词的模型调用，共享同一份「计划」作为上下文，中间产物全部写入 D1（`agent_events` 可回放）。Planner 输出等用户确认后才进入 Builder，对应 Atoms 里「Team Leader 在关键节点等人批准」的思路。
- **生成物运行**：单文件 HTML，允许 Tailwind CDN 与 Google Fonts，其余外部脚本会被 Reviewer 标记。预览用 `iframe sandbox="allow-scripts"`（不给 `allow-same-origin`），`/raw/*` 响应额外加 `Content-Security-Policy: sandbox`，生成物拿不到访问者的 Cookie。
- **成本护栏**：默认走 Gemini 免费额度——Builder 用 `gemini-3.5-flash`，Planner / Reviewer 用更便宜的 `gemini-3.5-flash-lite`（`LLM_MODEL_FAST`）；429/503 自动退避重试；每用户每日上限（`DAILY_GEN_LIMIT`=10）+ 全站每日总上限（`GLOBAL_DAILY_GEN_LIMIT`=60）；API Key 只存在服务端 Secret。

## 关键取舍

| 选择 | 放弃 | 原因 |
|---|---|---|
| 单文件 HTML 产物 | 多文件 React 工程 + 打包 | 8 小时内稳定跑通；无构建链即可预览 |
| 三个顺序角色 + 用户确认门 | Agent 框架、8 个专职角色 | 已体现「智能体驱动」；更多角色只是提示词 |
| Cookie + D1 会话 | KV | Workers 免费档 KV 每日仅 1000 写 |
| PBKDF2 (WebCrypto) | bcrypt | Workers 免费档单请求 10ms CPU |
| 邮箱密码自助注册 | 验证码 / OAuth | 评测最顺；Worker 不发邮件 |
| Workers + Static Assets | Pages Functions | 一条 `wrangler deploy`，SSE 与 D1 绑定更直接 |

## 完成度

- 已完成：注册/登录/登出、创建项目、Planner 规划 + 可编辑确认、Builder 流式生成、Reviewer 静态 + 模型审查、iframe 预览（桌面/手机/新标签）、版本列表与切换、对话迭代出新版本、失败重试、分享/取消分享、公开分享页、Remix、作品墙、每日配额、空态与错误提示
- 部分：版本间只能切换查看，没有 diff 视图；Reviewer 只报告不自动修补
- 未做：多文件工程、部署生成物到独立域名、可视化编辑器、团队协作

## 如果继续投入

1. **P1** Reviewer 发现问题后自动触发一次 Builder 修补（`fixed` 状态）
2. **P1** 版本 diff 与「回滚为新版本」
3. **P2** 浏览器内 esbuild-wasm 支持多文件 / React 产物
4. **P2** Race 模式：同一计划并行两个模型，用户挑一个
5. **P3** 一键部署生成物到用户自己的 Pages / 自定义域名

## 本地运行

```bash
npm install
cp .dev.vars.example .dev.vars        # 填入 LLM_API_KEY，可选覆盖 LLM_BASE_URL / LLM_MODEL
npx wrangler d1 migrations apply atoms-demo --local
npm run build && npx wrangler dev     # http://localhost:8787
# 或前端热更新：另开终端 npm run dev（Vite 5173，API 代理到 8787）
```

## 部署（Cloudflare）

```bash
npx wrangler login
npx wrangler d1 create atoms-demo     # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler d1 migrations apply atoms-demo --remote
npx wrangler secret put LLM_API_KEY
npm run deploy                        # 输出 https://atoms-demo.<subdomain>.workers.dev
```

如需换模型，改 `wrangler.jsonc` 的 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_MODEL_FAST`（例如 DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat`）。

## 实测（本地，Gemini 3.5）

输入「做一个番茄钟，可以设置专注时长，记录今天完成了几个番茄」：Planner 2s 出计划 → Builder 42s 生成 28.6K 字符单文件 HTML → Reviewer 11 项检查全部通过 → 分享 → 另一账号 Remix 成功。一次完整生成消耗 3 次模型调用。

## 使用的 AI 工具

整体架构、排期与代码在 Cursor 中与模型协作完成：先产出方案文档与取舍，再逐文件生成 Worker、D1 Schema 与 React 页面，最后用脚本对 API 做冒烟测试（注册/重复注册/错误密码/未登录 401/SSE 错误事件）。人工介入集中在：安全边界（sandbox、CSP、Secret）、免费额度约束（KV/CPU）、以及评测流程的取舍。
