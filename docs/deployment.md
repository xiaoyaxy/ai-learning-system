# Demo 运行与部署

按 2026-10-14 用户指示，以简单、快速可运行为目标：一个云环境，不拆 staging／production。代码使用两个 Worker（网页与 API），API 仅通过网页的 Service Binding 调用。

## 1. 本地零配置演示

Node.js 24、npm 11：

```sh
npm ci
npm run demo
```

打开 http://127.0.0.1:8787 。命令自动构建网页、应用本地迁移、启动 Workers。固定回复模式在界面标明，只有 local 环境允许启用，使用本地单人身份。数据目录 `.wrangler/demo` 不提交。测试另用 `.wrangler/e2e`。

## 2. 本地真实 AI

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run migrate:local
npm run dev
```

编辑 `.dev.vars`：保留 `DEPLOYMENT_ENV=local`、本地身份和 Origin；填入 `MODEL_PROVIDER=compatible`、准确模型名、完整 HTTPS Chat Completions URL、API Key，以及 `SEARCH_PROVIDER=tavily`、搜索 Key。部分模型需要 `MODEL_TOKEN_PARAMETER=max_completion_tokens`。不支持 JSON 的模型会明确报格式错误。

适配协议：[JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)、[Tavily search](https://docs.tavily.com/documentation/api-reference/endpoint/search)。输出还需要通过应用 schema 校验；用量仅采用供应商实际返回的数据，缺失显示未知。

## 3. 一个 Cloudflare demo 环境

按用户要求部署到单一 Cloudflare demo 环境。目前正在恢复账号授权；授权完成后创建 D1、应用迁移、配置 Secrets，并部署两个 Worker。

```sh
npx wrangler login
npx wrangler d1 create ai-learning
```

把返回的 database_id 写到 `apps/api/wrangler.jsonc` 的 D1 binding，保留 `DEPLOYMENT_ENV=cloud`。API 的 `workers_dev=false`，不添加公共路由。

在 API 配置的 vars 中填写模型／搜索类型、模型名、API URL（不含 Key）、`PUBLIC_ORIGIN`（网页实际 HTTPS origin），以及访问控制的 `ACCESS_ISSUER`、`ACCESS_AUDIENCE`、`ALLOWED_EMAIL`。密钥交互写入：

```sh
npx wrangler secret put MODEL_API_KEY -c apps/api/wrangler.jsonc
npx wrangler secret put SEARCH_API_KEY -c apps/api/wrangler.jsonc
npm run migrate:remote
npm run deploy
```

先部署 API 再部署 Web。Web 默认可以使用 workers.dev 地址；在 Cloudflare Access 给网页地址建立仅允许本人邮箱的应用，并把该应用 issuer／audience 配到 API。如使用自定义域名，在 Web 配置添加对应 route，再调整 PUBLIC_ORIGIN。API 会独立校验 Access JWT，未配置登录不会开放个人学习数据。[Access JWT 验证](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

如选择 Workers AI，改 `MODEL_PROVIDER=workers-ai`，填写支持 JSON 的准确模型名，在 API Wrangler 配置添加 `"ai":{"binding":"AI"}`，无需 MODEL_API_KEY／URL。[Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/)、[JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)。不要把固定演示回复当云端 AI。

部署后重新打开网页，以本人登录新建两个项目、提交答案、暂停并刷新、导出文件，确认实际保存。`GET /api/v1/readiness` 需登录，显示配置状态；`writable=not_probed` 仅表示尚未写入探测，不能当作数据库写入验收。

## 4. 当前限制

- DeepSeek 与 Tavily 已完成本地真实链路验证，生成定义、资料地图、计划和任务卡；云端部署等待 Cloudflare 重新授权。内容质量仍需按实际学习项目检查。
- 资料只使用搜索摘要与链接；安全全文读取 transport 未配置，不直接放开任意 URL fetch。
- 每个 run 上限 8 次模型、12 次工具、6 次交接；外部请求 30 秒、模型输出 2,048 tokens、上下文 24,000 字符。超时可能已产生供应商费用，需要用户明确重试。
- 不承诺全部免费；模型／搜索／Workers／D1／Agent 用量需在实际账户核对。不会自动升级付费。
- 云端迁移是追加式；回滚应用版本时保留现有数据库和答题／诊断历史，不执行删表重建。

## DeepSeek 与本地代理

服务端可设置 `MODEL_NAME=deepseek-flash`、`MODEL_API_URL=https://api.deepseek.com/chat/completions`、`MODEL_THINKING=disabled`。JSON 输出和可选 thinking 参数按 [DeepSeek JSON 文档](https://api-docs.deepseek.com/guides/json_mode/) 与 [thinking 文档](https://api-docs.deepseek.com/guides/thinking_mode/) 实现；其他兼容供应商未配置该选项时不会收到 thinking 参数。

如果本机联网依赖代理，将已有的 HTTP(S)_PROXY 和 NODE_USE_ENV_PROXY=1 写入根目录 `.env.proxy`（已忽略），本地 Node 启动会读取；此配置不进入 Cloudflare 部署。自动浏览器测试使用 tests/e2e/workers 配置目录，与个人密钥目录分开。

Tavily 使用基础搜索：[免费档每月1,000 credits，基础搜索每次1 credit](https://docs.tavily.com/documentation/api-credits)。配置 SEARCH_PROVIDER=tavily、SEARCH_API_KEY 后自动采集资料摘要与链接；全文安全提取仍未配置。
