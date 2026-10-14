# 知行 AI 辅助学习系统

个人、多项目、四角色群聊学习系统。React 前端与 Hono API 独立构建，使用 Cloudflare Agents SDK 与 D1。

实现正在进行，当前进度见提交记录。HTML 演示在 prototype/，不代表真实模型或云端能力。

## 开发

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

使用 Node.js 22 或更新的 LTS。模型、搜索与登录配置仅放服务端环境变量，禁止提交密钥或真实学习数据。未确认的评分政策不启动自动完成判定。

## 设计

- [需求](docs/superpowers/specs/2026-10-13-ai-learning-system-design.md)
- [技术设计](docs/technical-design.md)
- [实施计划](docs/superpowers/plans/2026-10-14-ai-learning-system.md)
