# Demo 验收记录

日期：2026-10-14。目标：单一 demo 环境，快速本地运行。自动验证使用真实本地 Workers、Agents SDK 和 D1，模型／搜索明确使用固定替身；供应商适配器使用受控 HTTP fixture。另已验证 DeepSeek + Tavily 的真实本地计划生成链路；云端部署和账户额度仍待验证。

## 自动验证

已通过 `npm run typecheck`、`npm test`（109 项：API 98、Web 6、契约 5）、`npm run build`（含 Wrangler dry-run）、`npm run test:e2e`（9 个浏览器流程，2.0 分钟）。构建检查未上传 Cloudflare。浏览器截图生成到本地 `test-results/workspace-*.png`，不提交个人学习数据。

| 编号         | 已实现与自动验证入口                                                |
| ------------ | ------------------------------------------------------------------- |
| A01 项目隔离 | repository/http tests、两个项目浏览器流程、草稿分键                 |
| A02 定题     | planning/service tests，最多三问、缺项与原话                        |
| A03 @ 专家   | contracts mention tests、permissions tests、浏览器 @ 路由           |
| A04 原始诊断 | repository 不可变约束、planning/service tests                       |
| A05 资料地图 | resources tests：三层资料、概念／误解、来源状态与引用               |
| A06 测验     | assessment/service tests、首错一次追问再揭示、私有答案              |
| A07 反馈调整 | planning/adjustment tests、总管交接与版本化提案                     |
| A08 自主调整 | goal-impact/adjustment tests：无目标影响自动激活                    |
| A09 目标请示 | adjustment tests、延期提案浏览器流程、接受／保留／暂停              |
| A10 学习卡   | archive tests：真实表达引用、缺项补问，浏览器整理                   |
| A11 复习复盘 | reviewDates 跨午夜／DST、+1／+3、四问、统计复算                     |
| A12 成果审阅 | archive tests、原稿／意见／终稿／导出浏览器流程                     |
| A13 完成检验 | confirmed policy、固定分母／整数80%、重新检验与纠正口径             |
| A14 中断重复 | repository/runner tests、暂停刷新恢复、相同操作ID与409浏览器流程    |
| A15 异常     | source-reader/live-adapters tests、429／401／超时／畸形JSON／D1失败 |
| A16 协作受控 | 持久事件、预算、权限 tests、暂停继续浏览器流程                      |

以上验证的是代码行为；A05、A06、A07、A10、A12 等实际内容质量仍需真实模型人工检查。

## 尚未运行

| 项目                                           | 状态与原因                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 中文教学质量                                   | DeepSeek flash 已实际调用并生成计划；完整教学质量评估未运行，样例见 tests/evals/cases.jsonl |
| 引用质量                                       | Tavily 基础搜索已实际返回资料；全文 transport 未配置，完整引用质量评估未运行                |
| Cloudflare 部署、Access 本人登录和在线持久恢复 | 用户已要求部署；本机 OAuth 过期，等待重新登录授权                                           |
| Worker CPU、D1读写、DO、模型／搜索真实用量     | 尚无真实链路／账户记录，不记作零                                                            |
| 推送提醒                                       | 未配置；复习记录保留在应用中                                                                |

这些限制不阻止 `npm run demo` 本地演示。云端／真实模型验收完成前，不标记“已上线”或“真实质量通过”。

## 最终审阅

完成一次独立、只读的整分支审阅。4 个重要问题均先复现失败再修复：控制命令原子提交、诊断／周复盘按收据恢复、笔记更新重试、项目列表独立滚动。修复后全量 103 项自动测试及 9 项浏览器流程通过。

保留两项云端交互小问题：登录过期提示目前与断网相同；导出尚未额外拒绝登录页 HTML200。本地 demo 无登录重定向，不受这两个场景影响。详情与全部实施决定见 implementation-notes.md。

截图复核还修正了侧栏项目行压缩；对应浏览器用例再次先失败后通过，覆盖30个额外项目、文字不重叠与输入框留在视口。

## 真实供应商接入验证

使用独立且标明测试数据的项目，未改写个人已有学习项目。DeepSeek `deepseek-flash` 实际生成项目定义、5项学习任务、任务卡；Tavily 提供三层资料搜索结果，生成知识地图并保存到本地 D1。未将密钥或个人学习记录提交到 GitHub。

修复 Workers 不支持 `redirect=error` 的问题，改为 manual 并拒绝重定向；为模型提供严格的完整响应 JSON Schema，避免把内部类型当作外层 action。计划现在直接显示在会话顶部，普通专家回复携带当前目标、有效计划和任务上下文。测试配置与个人凭据目录分开，测试不会调用真实供应商。
