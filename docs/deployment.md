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

## 3. Cloudflare demo

当前已部署：[知行学习群](https://ai-learning-web.syl-pi-agent.workers.dev)。使用单人访问密码，不需要 Cloudflare Access 或绑定银行卡。首次输入密码后，安全 Cookie 保持登录12小时；过期时刷新页面重新登录。

当前账号和 D1 ID 已写入 Wrangler 配置。复制到自己的账号时，需要改 `account_id`，创建自己的 D1 并替换 `database_id`。`PUBLIC_ORIGIN` 必须是网页实际 HTTPS origin。API 的 `workers_dev=false`，仅通过网页的 Service Binding 调用。

```sh
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write d1:write
npx wrangler d1 create ai-learning
npx wrangler secret put MODEL_API_KEY -c apps/api/wrangler.jsonc
npx wrangler secret put SEARCH_API_KEY -c apps/api/wrangler.jsonc
npx wrangler secret put DEMO_ACCESS_PASSWORD -c apps/api/wrangler.jsonc
npx wrangler secret put DEMO_SESSION_SECRET -c apps/api/wrangler.jsonc
npm run migrate:remote
npm run deploy
```

访问密码使用至少16字符的随机值，签名密钥至少32字符，均只存于 Secrets；账号内本次已配置四项 Secrets。云端 `AUTH_MODE=demo-password`，未正确配置密码与签名密钥时拒绝访问。登录检查同源 Origin，Cookie 使用 Secure、HttpOnly、SameSite=Strict，认证固定为唯一 demo 用户。个人密钥、密码文件和本地学习记录不会提交到 GitHub。

先部署 API，再部署 Web。首次迁移和两 Worker 上传均已成功；后续部署使用同一数据库，不删表重建。`GET /api/v1/readiness` 需要登录，展示实际供应商配置；`writable=not_probed` 本身不代表写入验证。真实学习内容质量和账户额度需单独检查。

如以后选择 Cloudflare Access，可将 `AUTH_MODE` 改为 `access` 并配置 `ACCESS_ISSUER`、`ACCESS_AUDIENCE`、`ALLOWED_EMAIL`；当前 demo 不依赖这项服务。Workers AI 也保留为可选供应商，但本次使用 DeepSeek。

## 4. 当前限制

- DeepSeek 与 Tavily 已完成本地真实链路验证，生成定义、资料地图、计划和任务卡；云端已部署，密码登录已验证。内容质量仍需按实际学习项目检查。
- 资料只使用搜索摘要与链接；安全全文读取 transport 未配置，不直接放开任意 URL fetch。
- 每个 run 上限 8 次模型、12 次工具、6 次交接；外部请求 30 秒、模型输出 2,048 tokens、上下文 24,000 字符。超时可能已产生供应商费用，需要用户明确重试。
- 不承诺全部免费；模型／搜索／Workers／D1／Agent 用量需在实际账户核对。不会自动升级付费。
- 云端迁移是追加式；回滚应用版本时保留现有数据库和答题／诊断历史，不执行删表重建。

## DeepSeek 与本地代理

服务端可设置 `MODEL_NAME=deepseek-flash`、`MODEL_API_URL=https://api.deepseek.com/chat/completions`、`MODEL_THINKING=disabled`。JSON 输出和可选 thinking 参数按 [DeepSeek JSON 文档](https://api-docs.deepseek.com/guides/json_mode/) 与 [thinking 文档](https://api-docs.deepseek.com/guides/thinking_mode/) 实现；其他兼容供应商未配置该选项时不会收到 thinking 参数。

如果本机联网依赖代理，将已有的 HTTP(S)_PROXY 和 NODE_USE_ENV_PROXY=1 写入根目录 `.env.proxy`（已忽略），本地 Node 启动会读取；此配置不进入 Cloudflare 部署。自动浏览器测试使用 tests/e2e/workers 配置目录，与个人密钥目录分开。

Tavily 使用基础搜索：[免费档每月1,000 credits，基础搜索每次1 credit](https://docs.tavily.com/documentation/api-credits)。配置 SEARCH_PROVIDER=tavily、SEARCH_API_KEY 后自动采集资料摘要与链接；全文安全提取仍未配置。
