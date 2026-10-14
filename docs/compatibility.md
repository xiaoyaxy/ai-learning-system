# Cloudflare 兼容验证

选定版本从 package-lock.json 读取，开发使用 Node 24 LTS，最低 Node 22。Workers compatibility_date 为 2026-10-13，启用 nodejs_compat。

Agents 0.28.0 的旧 subAgent 方法仍可用，但已弃用。本实现采用 dynamicAgents.get 创建受总管管理的专家实例。固定角色任务适合这一隔离机制；每个项目仍是独立顶层 Durable Object。

T01 测试覆盖健康路由、Web 转发的真实服务 binding、专家 RPC 与实例驱逐后的持久回调。结果在任务完成后写入，不以编译成功代替运行验证。

验证结果：T01 平台 4/4、contracts 2/2 通过，TypeScript strict 类型检查通过，API 与 Web Wrangler dry-run 构建成功。测试插件固定 @cloudflare/vitest-plugin 1.4.0，Vitest 4.1.0、Wrangler 4.149.0；锁文件保存其余精确版本。实际 workerd 支持日期上限为 2026-10-13，因此两个 Worker 与测试采用同一日期。测试中的非绑定子类通过 additionalExports 注册为 DurableObject；生产不公开测试入口。

上游 agents 依赖的部分 sourcemap 缺少源文件，测试有映射警告但无运行错误。真实账户部署与模型质量尚未验收。
