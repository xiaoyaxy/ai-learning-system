# 知行 · AI 学习群

个人、多项目学习 demo：总管、规划师、知识管家和陪练官在群聊里协作。React + Hono + Cloudflare Agents SDK + D1，学习记录保存在后端，刷新页面可以继续。

## 快速跑起来

需要 Node.js 24 和 npm 11。首次安装后，一条命令启动：

```sh
npm ci
npm run demo
```

打开 http://127.0.0.1:8787 。未配置 `.dev.vars` 时无需账号或 API Key，使用明确标注的本地固定模型／搜索回复；数据库保存在 `.wrangler/demo`，与自动测试数据分开。固定回复用于演示交互流程，不能据此判断真实 AI 教学质量。若已有服务端 `.dev.vars` 配置，`npm run demo` 会使用指定的真实模型和搜索，并保留同一份本地数据。

新建项目后，回答定题问题、提交起点诊断，再查看资料和计划。可以 @ 专家、练习／完成检验、修改检验政策、补充要求、暂停／继续，提交初稿／终稿、整理学习卡、复盘和导出 Markdown。完成检验需要你先确认政策，并覆盖完整题目后按 80% 门槛判断。

## 接入真实 AI（可选）

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
# 填写 MODEL_NAME、MODEL_API_URL、MODEL_API_KEY、SEARCH_API_KEY
npm run migrate:local
npm run dev
```

默认适配 OpenAI 兼容 Chat Completions 接口和 Tavily 搜索；也提供 Workers AI binding 适配。模型需要支持 JSON 输出。密钥只放服务端 `.dev.vars` 或 Cloudflare secrets，这些文件不会提交。支持 DeepSeek：模型 `deepseek-flash`、URL `https://api.deepseek.com/chat/completions`，可设 `MODEL_THINKING=disabled` 优先演示速度。密钥仍需各自配置。

## 检查与部署

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

仅一个 demo 云环境，不分 staging／production。已部署：[打开学习群](https://ai-learning-web.syl-pi-agent.workers.dev)。输入单人 demo 访问密码即可使用；密钥和密码只保存在 Cloudflare Secrets。本机密码文件为被忽略的 `.env.demo-access`。重新部署执行 `npm run migrate:remote`、`npm run deploy`；步骤见 [运行与部署](docs/deployment.md)。

## 项目文件

- `apps/web`：群聊、项目列表、待答／政策／变更卡、档案与导出。
- `apps/api`：角色编排、持久任务、资料、测验、调整、归档与服务端供应商。
- `packages/contracts`：命令、公开 DTO 和校验。
- `tests/e2e`：真实本地 Workers／D1 的浏览器流程，使用固定供应商替身。
- [需求](AI学习多Agent系统-岗位卡片.md)、[技术设计](docs/technical-design.md)、[实施计划](docs/superpowers/plans/2026-10-14-ai-learning-system.md)、[验收记录](docs/acceptance.md)。

当前资料采集提供搜索摘要和链接；默认不抓取任意网页全文。学习卡引用用户实际表达，缺项会补问；成果审阅只给意见，保留原稿。未揭示参考答案不会出现在公开档案或导出里。

本机需要网络代理时，可将现有 `HTTPS_PROXY`、`HTTP_PROXY` 和 `NODE_USE_ENV_PROXY=1` 放到被忽略的 `.env.proxy`；本地启动会自动读取。浏览器测试配置位于独立目录，不加载个人 `.dev.vars`。
