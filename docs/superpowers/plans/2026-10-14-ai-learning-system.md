# AI 辅助学习系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立真实的多项目四角色群聊学习闭环，保留学习证据、支持恢复与目标请示，并依据用户确认的评分政策执行 80% 完成检验。

**Architecture:** Web Worker 独立发布 React 静态前端，通过 Service Binding 调用 Hono API Worker。每项目一个 Cloudflare 持久总管，以子 Agent RPC 调用专家；D1 保存学习档案、提交收据与公开事件，Agent SQLite 保存可对账的运行检查点。

**Tech Stack:** TypeScript strict、React、Vite、TanStack Query、Hono、Zod、Cloudflare Agents SDK、D1 prepared statements、Wrangler、npm workspaces、Vitest、Cloudflare Workers 测试运行时、Playwright。

**Spec:** [技术设计 v0.2](../../technical-design.md)，产品依据为 [MVP 需求文档](../specs/2026-10-13-ai-learning-system-design.md)。执行者同时阅读两份；原型口径不能覆盖需求。

日期：2026-10-14｜状态：待实施评审｜本计划中的文件均为拟创建文件，测试命令尚未运行。

## Global Constraints

- 当前仅一人使用，同时支持多个学习项目，各自安排学习时间。
- 独立网页、群聊模式，学务总管主要派活，用户可以直接 @ 任意角色。
- 四角色为学务总管、规划师、知识管家、陪练官。
- 自动联网搜集资料；原始诊断不可覆盖，答题与调度记录只追加。
- 日常调整可自主执行；可能影响用户明确目标时，先请示、后生效。
- 项目相关考题答对至少 80% 是完成标准；初稿、终稿不增加额外完成门槛。
- 前后端分离，Cloudflare 一体部署，Cloudflare Agents SDK、D1，免费方案优先。
- Workers compatibility_date 固定为 `2026-10-13`，依赖精确版本在 T01 验证后写入 package-lock.json。
- 单次 run 最多 8 次模型请求、12 次业务工具调用、6 次专家交接；最多 2 次单步骤自动重试（额外尝试），单次外部请求超时 30 秒；输出上限 2,048 tokens；一个步骤最多读取 8,000 字符来源片段。
- 单页消息／事件最多 50 条；正文限制 12,000 Unicode 字符，请求体限制 64 KiB。
- 未确认评分政策不得自动判定 met；未配置生产鉴权不得开放个人数据；不得自动升级付费。
- 需求文档、岗位卡片与 prototype/ 原文件保留；HTML 的 5 题、首答统计、每日分钟和模拟模型不迁移为正式默认规则。

## Review Focus

1. 相同操作 ID 带不同正文、两个标签页提交旧 revision：冲突明确，已保存原话不覆盖，旧结果不写入。测试归 T02、T03。
2. 暂停发生在模型返回前、D1 提交后 Agent 尚未保存检查点时重启：epoch 拒绝旧提交，按收据恢复，不重复答案与计划。测试归 T04。
3. 未作答或首答错误时，从事件、档案、导出或 @ 知识管家套取答案：所有公开投影都不泄露参考答案，先追问一次。测试归 T03、T07、T10。
4. 中文开放题不确定、完成检验缺题、跨目标版本或临界百分比：等待判定、完整分母、旧结果 stale，整数比较 80%。测试归 T07。
5. 跨本地午夜／时区、资料读取失败／恶意网页、配额或存储不足：复习按项目日期排，来源待确认，错误保留已有进度且未知用量不记零。测试归 T06、T10、T11。

---

## 1. 实施顺序与启动条件

本系统是一个学习闭环，采用一份计划按依赖实施，不把模块拆成可独立上线的产品。

| 阶段 | 任务 | 可验收交付 | 依赖 |
| --- | --- | --- | --- |
| M1 可信基础 | T01–T04 | 双 Worker 与 SDK 兼容、项目隔离、幂等、权限、持久调度和恢复 | 技术设计评审 |
| M2 学习闭环 | T05–T08 | 定题诊断、自动资料、测验、成绩证据、自主调整与请示 | M1；真实供应商未选可用明确测试替身 |
| M3 可用网页 | T09–T10 | 真实群聊、档案、复习周报与成果审阅 | M2 |
| M4 真实运行验收 | T11 | 供应商质量、访问控制、CPU／额度、端到端验收与发布记录 | M3＋本人部署配置 |

评分规则、时间形式和供应商待定不阻止编写隔离模块与测试，但会限制对应真实功能。T07 的 fixture confirmed policy 仅在测试使用；T11 前需为真实完成检验集中确认政策。提醒推送不在本轮建立自动任务，保留未配置状态。

预计一名熟悉 TypeScript／Workers 的实施者需要约 8–12 个工作日，另预留 2–3 日真实模型评估与部署验证；这是规划估计，账户授权、供应商选择或 SDK 兼容失败可能改变工期。M1、M2、M3 每阶段做一次可运行演示，不能以 mocked 流程宣布真实能力完成。

## 2. 文件与接口责任

| 路径 | 责任 | 首次产生任务 |
| --- | --- | --- |
| package.json、package-lock.json、tsconfig.base.json | workspace、锁定版本、检查脚本 | T01 |
| apps/web/package.json、vite.config.ts、wrangler.jsonc、worker.ts、index.html、src/main.tsx | 独立前端构建与同源 API 转发 | T01 |
| apps/api/package.json、wrangler.jsonc、vitest.config.ts、src/index.ts、src/env.ts | Worker 入口、bindings、测试运行时 | T01 |
| packages/contracts/package.json、src/commands.ts、src/public.ts、src/index.ts | 公共命令、DTO、事件与校验 | T01 |
| apps/api/src/db/migrations/0001_initial.sql、repository.ts、types.ts | 全部表、约束、参数查询、原子提交 | T02 |
| apps/api/src/http/auth.ts、routes.ts、projector.ts、errors.ts | 鉴权、API、公开投影 | T03 |
| apps/api/src/agents/project-supervisor.ts、planner.ts、curator.ts、coach.ts、prompts.ts | 四角色与业务调度 | T04–T08 |
| apps/api/src/runtime/types.ts、runner.ts、budget.ts、tool-context.ts | 内部契约、检查点、限额与权限上下文 | T04 |
| apps/api/src/domain/permissions.ts、state-machine.ts、goal-impact.ts、assessment.ts | 可测试业务规则 | T04、T07、T08 |
| apps/api/src/features/planning/service.ts | 定题、诊断、计划、任务卡与调整 | T05、T08 |
| apps/api/src/features/resources/service.ts、providers/search.ts、source-reader.ts、model.ts、fixtures.ts | 资料、来源、供应商适配与测试替身 | T04、T06、T11 |
| apps/api/src/features/assessment/service.ts、types.ts | 私有评分参考、作答、评价与完成证据 | T07 |
| apps/api/src/features/archive/service.ts、export.ts、review.ts | 用户表达整理、归档、周报、复习日期与导出 | T10 |
| apps/web/src/api/client.ts、features/projects/ProjectList.tsx、ProjectSettings.tsx | API 与项目入口 | T09 |
| apps/web/src/features/chat/ChatWorkspace.tsx、Composer.tsx、MessageFeed.tsx、RunControls.tsx、useProjectEvents.ts | 群聊交互与恢复 | T09 |
| apps/web/src/features/assessment/QuestionCard.tsx、CompletionEvidence.tsx、PolicyCard.tsx、features/planning/DecisionCard.tsx | 待答、政策、成绩和请示卡片 | T09 |
| apps/web/src/features/archive/ArchivePanel.tsx、ArtifactView.tsx、SubmissionCard.tsx、features/chat/chat.css | 档案与成果、响应式样式 | T09–T10 |
| tests/e2e/playwright.config.ts、learning.spec.ts、tests/evals/cases.jsonl | 浏览器流程与模型质量样例 | T09、T11 |
| docs/compatibility.md、deployment.md、acceptance.md | 当前版本、运行配置与真实验收记录 | T01、T11 |

为每个文件在所属任务创建对应 `*.test.ts` 或 `*.test.tsx`。同名测试放实现文件旁；端到端测试集中 tests/e2e。下面代码块是关键测试断言，local fixture 函数也在对应任务定义，不使用未声明的全局测试服务。

## 3. 任务清单

### Task 1: T01 验证部署骨架与公共契约

**Files:** 创建文件表中 T01 的文件，以及 `apps/api/src/platform.test.ts`、`packages/contracts/src/commands.test.ts`、根 `README.md`。

**Interfaces:**

- 公共 Role、RunStatus、Phase、GoalImpact、CompletionStatus 与 PublicEventType 按技术设计第 4 节逐项定义。
- `ProjectCommand` 判别联合涵盖设计第 9 节的全部命令；send_message 载荷为 `{text, target_role?, mode:'message'|'answer'}`；submit_answer 为 `{question_id, question_version, attempt_index, text}`；decide_proposal 为 `{proposal_id, proposal_version, decision:'accept'|'retain'|'pause'}`。其余载荷在所属任务增加具体 schema，未实现命令返回 NOT_IMPLEMENTED，不伪成功。
- `CommandEnvelopeSchema`、`CreateProjectSchema`、`PublicEventSchema`；schema 用 strict object，拒绝额外权限字段。
- `Env` 包含 DB:D1Database、PROJECT_SUPERVISOR:DurableObjectNamespace、deployment environment；Web Env 包含 ASSETS:Fetcher、API:Fetcher。
- `WorkspaceDTO` 包含 design 第 9 节的公开字段，公开 question 只含 id、version、prompt、attempt_index；policy 只公开政策说明，不含每题私有参考。

- [ ] **Step 1：建立 workspace 与测试入口。** 按文件表创建最小配置，npm scripts 提供 dev、build、typecheck、test、test:e2e。选择精确依赖组合、锁定版本，启用 TS strict；Workers 单测使用官方 Workers Vitest 集成，前端组件测试使用 jsdom、Testing Library。此步骤只建立任务所需的骨架。
- [ ] **Step 2：写先失败的兼容与 schema 测试。** 平台 fixture 用测试父 Agent 与 EchoChild，证明 RPC、schedule callback 和 Service Binding；测试实现完后保留作为兼容 smoke，不能公开测试端点。

```ts
expect(CommandEnvelopeSchema.safeParse({
  client_operation_id: crypto.randomUUID(), expected_revision: 0,
  command: {type: 'send_message', text: '我想学 Agent', mode: 'message', actor_role: 'coach'}
}).success).toBe(false);
// 平台测试在 Workers runtime 中检查，而不是 mock 掉 SDK。
expect(await child.echo('项目一')).toBe('项目一');
expect(await scheduledResult()).toEqual({checkpoint: 'persisted'});
expect((await web.fetch('/api/v1/health')).status).toBe(200);
```

- [ ] **Step 3：运行失败测试。** `npm test --workspace packages/contracts -- commands.test.ts`、`npm test --workspace apps/api -- platform.test.ts`；预期缺失实现或断言失败，不把配置／导入错误当作有效红灯。
- [ ] **Step 4：实现最小平台连接与契约。** 导出 Agent 类、配置 SQLite migration、静态资源与 `/api/*` 转发、健康路由；在测试 fixture 内定义 child、scheduledResult、web。兼容日期固定 2026-10-13；以选定 SDK 类型确认 subAgent 与 schedule 的参数，不凭旧样例推断。
- [ ] **Step 5：验证并记录。** 上述测试全部 PASS；`npm run typecheck` 与 `npm run build` 成功。docs/compatibility.md 记录精确版本、SDK 接口、兼容标志、测试命令与真实结果。兼容未通过不得推进依赖任务。
- [ ] **Step 6：提交。** `git add package.json package-lock.json tsconfig.base.json README.md apps/web apps/api packages/contracts docs/compatibility.md`；`git commit -m "chore: verify Cloudflare workspace and contracts"`。仅暂存本任务新建的应用目录，不包含 prototype/ 和既有需求源文件。

### Task 2: T02 建立项目档案与幂等提交

**Files:** 创建 `apps/api/src/db/migrations/0001_initial.sql`、`types.ts`、`repository.ts`、`repository.test.ts`。

**Interfaces:**

- `ProjectRepository.create(ownerId:string, input:CreateProjectInput):Promise<ProjectRecord>`；创建幂等键按 owner_id＋client_operation_id 保存，项目尚不存在时也可复算原创建响应。
- `getProject(ownerId:string, projectId:string):Promise<ProjectRecord>`；越权不返回记录。
- `acceptCommand(ctx:IngressContext, input:CommandEnvelope):Promise<AcceptedCommand>`。
- `commitStep(ctx:StepContext, writes:StepWriteSet):Promise<StepReceipt>`；StepContext 包含 owner_id、project_id、operation_id、step_key、base_revision、epoch、actor。
- `readReceipt(projectId:string, operationId:string, stepKey:string):Promise<StepReceipt|null>`；`readWorkspace(projectId:string):Promise<WorkspaceRecord>`；`readEvents(projectId:string, afterSeq:number, limit:number):Promise<EventRecord[]>`。
- DB types 私有：ProjectRecord、WorkspaceRecord、StepReceipt 对应设计表；StepWriteSet 是具名 entity 写入数组＋公开事件，不接收 SQL 字符串。ArtifactKind 按设计第 3 节枚举，不可变类型与笔记版本明确区分。

- [ ] **Step 1：写失败测试。** fixture `makeRepositoryFixture()` 在 Workers 测试 D1 中执行迁移并创建两个不同项目，返回 `{repo, db, owner, p1, p2, ctx, command}`。至少覆盖以下断言及跨项目复合引用、原始诊断／答案 UPDATE 与 DELETE 触发器拒绝。

```ts
const first = await repo.acceptCommand(ctx, command);
expect(await repo.acceptCommand(ctx, command)).toEqual({...first, replayed: true});
await expect(repo.acceptCommand(ctx, {...command,
  command: {...command.command, text: '另一份正文'}
})).rejects.toMatchObject({code: 'IDEMPOTENCY_CONFLICT'});
await expect(repo.commitStep({...ctx, base_revision: -1}, writes))
  .rejects.toMatchObject({code: 'REVISION_CONFLICT'});
expect(await countArtifacts(db, p1.id)).toBe(0); // 过期 batch 整体回滚
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- repository.test.ts`；预期功能断言 FAIL。
- [ ] **Step 3：实现表、触发器与参数化 repository。** 全部业务表按技术设计第 3 节创建；command_receipts 做 payload_hash 冲突检查；step_receipts BEFORE INSERT 对 revision／epoch 用 RAISE(ABORT)。所有业务步骤在一个 D1 batch 中提交实体、事件与 revision；重复收据先读取再核对。创建项目与命令接受也要原子取得执行资格，计数与序号不能靠进程内变量。
- [ ] **Step 4：验证竞态与不可变规则。** 测试并发接受同操作只有一次实际写入；在触发器失败、中途语句失败时整批回滚；笔记新版本可写、原诊断不能覆盖；跨项目 source／attempt 引用失败。上面所有测试 PASS。
- [ ] **Step 5：提交。** `git add apps/api/src/db`；`git commit -m "feat: persist isolated learning records with idempotent commits"`。

### Task 3: T03 鉴权 API 与公开数据投影

**Files:** 创建 `apps/api/src/http/auth.ts`、`routes.ts`、`projector.ts`、`errors.ts`、`http.test.ts`；修改 `apps/api/src/index.ts`、`env.ts`、`packages/contracts/src/public.ts`。

**Interfaces:**

- `authenticate(request:Request, env:Env):Promise<Principal>`；Principal 为 `{owner_id:string}`，生产支持选定鉴权适配，本地身份仅在 local 环境允许。
- `toWorkspaceDTO(record:WorkspaceRecord):WorkspaceDTO`；`toPublicEvent(record:EventRecord):PublicEvent`；显式字段白名单。
- 路由使用设计第 9 节路径，注入 repository 与 `CommandDispatcher.accept(principal,projectId,envelope)`；T04 替换测试 dispatcher 为真实总管。
- `ApiError` 与 ErrorDTO 包含 code、message、retryable、可选 current_revision／entity_id。

- [ ] **Step 1：写失败测试。** fixture 创建 app、本人／他人身份以及带 `reference_answer='SECRET_CANARY'` 的内部题目。缺／过期／错误 audience JWT 拒绝；伪造邮箱头不能登录；local bypass 在 production 返回拒绝；外域 Origin 写请求拒绝。

```ts
expect((await app.request('/api/v1/projects/p2/workspace', owner1Request)).status).toBe(403);
expect(JSON.stringify(toWorkspaceDTO(internalWorkspace))).not.toContain('SECRET_CANARY');
expect(JSON.stringify(toPublicEvent(internalEvent))).not.toContain('rubric');
expect((await app.request('/api/v1/projects/p1/commands', staleRequest)).status).toBe(409);
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- http.test.ts`；预期鉴权、版本或白名单断言 FAIL。
- [ ] **Step 3：实现路由与身份防护。** JWT 签名、issuer、audience、exp 与本人允许身份全部验证；只转发已允许公开 API。JSON body 超过 64 KiB 返回 413，正文超过 12,000 Unicode 字符返回 422，分页最大 50。owner 校验先于收据结果读取，任何项目命令都不信任请求中的身份。SSE／SDK 通用公开 RPC 不注册。
- [ ] **Step 4：验证公开面。** 按工作台、事件、档案、run、错误路径检查未作答秘密 canary 不出现；不同项目 cursor 不串用。schema 的未知字段、长中文／emoji 输入和 malformed JSON 明确拒绝。测试 PASS，typecheck 成功。
- [ ] **Step 5：提交。** `git add apps/api/src/http apps/api/src/index.ts apps/api/src/env.ts packages/contracts/src/public.ts`；`git commit -m "feat: protect project APIs and public learning projections"`。

### Task 4: T04 四角色调度、权限、预算与恢复

**Files:** 创建文件表中的 agents/、runtime/，以及 `domain/permissions.ts`、`state-machine.ts`、`providers/model.ts`、`fixtures.ts`；创建 `runtime/runner.test.ts`、`domain/permissions.test.ts`；修改 Worker 入口注册四类。

**Interfaces:**

- `RoleTask = {project_id, run_id, epoch, step_key, role, action, evidence_ids, public_context}`；action 是服务器具名联合，不能直接来自用户字符串。
- `RoleResult = {kind, content, evidence_ids, next_action?, usage}`；模型返回 unknown，经 Zod 校验才成为 RoleResult。各业务内容 schema 在所属任务定义。
- `ModelGateway.generate(request:RoleModelRequest):Promise<RoleModelResult>`；RoleModelRequest 有角色、系统约束、隔离上下文、输出 schema 名称；返回结构内容、request_id 与 `usage:null|{input_tokens?,output_tokens?,neurons?}`，未知不填零。
- 三位专家 `execute(task:RoleTask):Promise<RoleResult>`；总管 `accept(principal:Principal,input:CommandEnvelope):Promise<AcceptedCommand>`、`advanceRun(payload:{run_id:string,epoch:number}):Promise<void>`、`reconcile():Promise<void>`。
- `authorizeTool(ctx:ToolContext, action:ToolAction):void`、`transition(state:LearningState, command:ProjectCommand):Transition`；ToolContext 只由服务器构造。
- `BudgetTracker.consume(kind:'model'|'tool'|'handoff'):void`；检查点包含 step_key、epoch、pending_input 与剩余预算。内部 epoch 与数据库 projects.run_epoch 是同一代际，repository 在提交时显式比较；不能混用 revision 和 epoch。

- [ ] **Step 1：写失败测试。** `makeRunnerFixture()` 注入 D1 repository、可延迟 resolve 的 ModelGateway、可重启 Agent 测试运行时；测试辅助 runner.pause(runId) 通过总管 accept 发送 pause_run，restartAfterD1Commit 在指定故障点重启并 reconcile，countCommittedStep 从 D1 收据计数。覆盖普通消息路由、明确 @、等待作答不给后续任务、陪练官建议必须经过总管交接。

```ts
expect(() => authorizeTool(coachCtx, {type:'activate_plan'})).toThrowError('FORBIDDEN');
await runner.pause(run.id);
delayedModel.resolve(oldResult);
expect(await repo.readReceipt(project.id, opId, oldStep)).toBeNull();
await restartAfterD1Commit();
expect(await countCommittedStep(stepKey)).toBe(1);
expect(model.callsFor(stepKey)).toBe(1);
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- runner.test.ts permissions.test.ts`；预期业务断言 FAIL。
- [ ] **Step 3：实现短步执行和调度。** 普通请求返回 run_id；事件记录派活／交接／等待；RoleResult 先校验再由权限工具提交。角色与 project_id 使用服务器上下文，专家无互派入口。用 schedule 持久 advanceRun 和恢复检查，SDK 参数按 T01 已验证版本调用；D1 提交收据先于 Agent 检查点。
- [ ] **Step 4：实现控制与预算。** pause／cancel／supplement 增 epoch 并中止可中止调用；resume 从已提交步骤续开代际。retry 不重复已提交写入，8／12／6 预算与 2 次额外重试共同生效。外部未知结果走 outcome_unknown，不能自动重试未知已收费调用。用户跳阶段告知影响、记录 skipped，不伪造完成证据。
- [ ] **Step 5：验证恢复窗口。** 覆盖命令接受后尚未 schedule、D1 提交后未写检查点、模型成功但未提交、暂停后旧返回、连续重试、429、D1 不可写。恢复成功路径不重复，失败路径明确停止；全部测试 PASS，typecheck 成功。
- [ ] **Step 6：提交。** `git add apps/api/src/agents apps/api/src/runtime apps/api/src/domain/permissions.ts apps/api/src/domain/state-machine.ts apps/api/src/providers apps/api/src/index.ts`；`git commit -m "feat: orchestrate bounded role tasks with durable recovery"`。

### Task 5: T05 定题、不可变诊断与计划任务卡

**Files:** 创建 `apps/api/src/features/planning/service.ts`、`apps/api/src/features/planning/service.test.ts`；修改 `apps/api/src/agents/planner.ts`、`apps/api/src/agents/prompts.ts`、`packages/contracts/src/commands.ts`。

**Interfaces:**

- `PlanningService.scope(ctx:ToolContext,input:{message_id:string}):Promise<ScopeResult>`；ScopeResult 是澄清一个问题、缺项状态或项目定义。
- `saveDiagnosis(ctx:ToolContext,messageId:string):Promise<ArtifactRef>`：从 repository 读取原文，不能接收模型改写正文。
- `createPlan(ctx:ToolContext,input:{definition_id:string,source_ids:string[],review_ids:string[]}):Promise<ArtifactRef>`；`createTaskCard(ctx:ToolContext,localDate:string):Promise<ArtifactRef>`。
- ProjectDefinition 为目的、scope_in、scope_out、目标技能、用户约束引用、成果初版里程碑；TaskCard 为目标、材料编号、三时间块建议、产出物和复习引用。
- `ArtifactRef = {project_id:string,id:string,kind:ArtifactKind,version:number}` 在 db/types.ts 定义并供内部模块使用。

- [ ] **Step 1：写失败测试。** 已有充分信息不重复问；第 3 问后仍缺字段不第 4 次追问、不生成教学内容；跨重启澄清计数保留。原话包含错字／口语也必须保留。

```ts
expect(savedDiagnosis.content).toBe('我觉得 Agent 就是会调工具的聊天，别的还说不清');
expect(scopeAfterThirdQuestion.kind).toBe('missing_fields');
expect(project.constraints.deadline).toBe('2026-10-28'); // 初版建议不替换期限
expect(plan.time_setting).toBeNull(); // 用户没有确认每日预算
expect(taskCard.blocks.map(x => x.kind)).toEqual(['deep','supplement','reflection']);
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- features/planning/service.test.ts`。
- [ ] **Step 3：实现规划能力。** 信息不足先问；保存定义／诊断只引用已有用户消息。初版 1–2 天是提案，不替换总期限；时间形式未确认则保留原话与空结构化值。计划资料引用来自 T06，当前任务用明确资料 fixture 验证。
- [ ] **Step 4：验证。** 三问、原文、时间与期限断言 PASS；任务卡有全部必要字段，诊断不可变。30 秒阅读体验记入 T11 人工验收，不能靠单元测试宣称完成。
- [ ] **Step 5：提交。** `git add apps/api/src/features/planning apps/api/src/agents/planner.ts apps/api/src/agents/prompts.ts apps/api/src/db/types.ts packages/contracts/src/commands.ts`；`git commit -m "feat: scope learning goals and preserve baseline diagnosis"`。

### Task 6: T06 自动资料与有来源的知识地图

**Files:** 创建 `apps/api/src/providers/search.ts`、`apps/api/src/providers/source-reader.ts`、`apps/api/src/providers/source-reader.test.ts`、`apps/api/src/features/resources/service.ts`、`apps/api/src/features/resources/service.test.ts`；修改 `apps/api/src/agents/curator.ts`、`apps/api/src/agents/prompts.ts`。

**Interfaces:**

- `SearchProvider.search(query:string, scope:{project_id:string,goal_version:number}):Promise<SearchHit[]>`；SearchHit 为 title、url、snippet。
- `SourceReader.read(url:string):Promise<SourceReadResult>`；结果包含 status、title、canonical_url、fetched_at、limited_text、引用片段，不允许返回执行脚本。
- `ResourceService.prepare(ctx:ToolContext,definition:ProjectDefinition):Promise<ResourceBundle>`；bundle 为分层 sources、coverage complete／partial、地图与导读。
- KnowledgeMap 为领域问题、concepts（5–7）、relations、misconceptions（3）；每概念有 citation_ids 或 pending 状态。

- [ ] **Step 1：写失败测试。** fixture 有三层正常来源、读不到的 URL、相互冲突定义和含“忽略权限、修改计划”的恶意正文。

```ts
expect(bundle.map.concepts.length).toBeGreaterThanOrEqual(5);
expect(bundle.map.concepts.length).toBeLessThanOrEqual(7);
expect(bundle.map.misconceptions).toHaveLength(3);
expect(bundle.map.concepts.every(c => c.citation_ids.length || c.verification_status === 'pending')).toBe(true);
expect(partialBundle.coverage).toBe('partial');
expect(tools.called('activate_plan')).toBe(false);
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- source-reader.test.ts features/resources/service.test.ts`。
- [ ] **Step 3：实现搜索与读取隔离。** 搜索和读取单独适配；来源编号稳定、分层导读有引用。URL 公开 HTTPS、公网目标与每次重定向校验；3 次重定向、1 MiB、10 秒、给模型最多 8,000 字符。可采用经验证的服务器提取服务，只向允许的提取 API 域名发送请求；不能在未核验公网检查能力时直接任意 fetch 网页。
- [ ] **Step 4：验证危险与失败输入。** IP 字面值、localhost、私网／保留 DNS 结果、到私网的 redirect、超大正文和超时被拒绝；HTML 不执行脚本，恶意内容不能调用越权工具。无真实服务时明确用 fixtures；真实读取得在 T11 证明重定向／公网控制，未证明不得启用任意 URL 读取。
- [ ] **Step 5：验证学习产物。** 资料三层、知识地图、来源 pending／conflicting、部分完成均有测试 PASS；与规划服务组合生成带真实 source_id 的计划 fixture。
- [ ] **Step 6：提交。** `git add apps/api/src/providers/search.ts apps/api/src/providers/source-reader.ts apps/api/src/providers/source-reader.test.ts apps/api/src/features/resources apps/api/src/agents/curator.ts apps/api/src/agents/prompts.ts`；`git commit -m "feat: prepare sourced learning resources and knowledge maps"`。

### Task 7: T07 测验状态、批改证据与 80% 完成计算

**Files:** 创建 `apps/api/src/features/assessment/types.ts`、`apps/api/src/features/assessment/service.ts`、`apps/api/src/features/assessment/service.test.ts`、`apps/api/src/domain/assessment.ts`、`apps/api/src/domain/assessment.test.ts`；修改 `apps/api/src/agents/coach.ts`、`apps/api/src/agents/prompts.ts`、`apps/api/src/http/projector.ts`、`packages/contracts/src/commands.ts`、`packages/contracts/src/public.ts`。

**Interfaces:**

- `AssessmentPolicy` 内部包含 version、status、question_count、required_skill_ids、rubric、partial_rule（count_correct／count_incorrect）、attempt_basis（first／after_correction）、aggregation（single_session／multi_session）、确认 message_id。多轮政策同时提供 session_selection（明确 session IDs）与每个 session 的完整题目清单，不按最近聊天自动推断。
- `AssessmentService.start(ctx:ToolContext,purpose:'practice'|'completion'):Promise<AssessmentSessionRef>`；`submit(ctx:IngressContext,input:SubmitAnswer):Promise<AttemptRef>`；`evaluate(ctx:ToolContext,attempt:AttemptRef):Promise<EvaluationRef>`。
- `computeCompletion(policy:AssessmentPolicy|null, evidence:CompletionEvidenceInput):CompletionEvidenceDTO`；输入只含完成检验、已绑定目标版本的完整题清单和全部评价；输出 status、correct_count、total_count、policy_version、goal_version 与逐题证据。
- 私有 QuestionSecret、EvaluationDraft 放本模块，不导出到 contracts。首答反馈 DTO 不含 explanation／reference_answer；reveal_allowed 由题目状态算，不能由模型自行授予。
- `proposePolicy` 只生成 draft；confirm_assessment_policy 必须引用真实用户消息及完整草案版本，trusted_ingress 确认；无真实确认时不能从测试 fixture 导入。

- [ ] **Step 1：写失败测试。** 测试 fixture 的 confirmed policy 固定 5 题、first、single_session、partial=count_incorrect，仅供测试；分别覆盖 after_correction 与指定多 session 聚合。关键断言如下。

```ts
expect(computeCompletion(null, evidence).status).toBe('policy_required');
expect(computeCompletion(policy5, correct4of5)).toMatchObject({status:'met',correct_count:4,total_count:5});
expect(computeCompletion(policy5, correct3of5).status).toBe('not_met');
expect(computeCompletion(policy5, only4Answered).status).toBe('in_progress');
expect(computeCompletion(policy5, unresolvedGrade).status).toBe('pending_review');
expect(computeCompletion(policy5, changedGoal).status).toBe('stale');
expect(computeCompletion(policy500, correct399of500).status).toBe('not_met'); // 79.8% 不四舍五入为达标
expect(firstWrongFeedback.followups).toHaveLength(1);
expect(JSON.stringify(firstWrongFeedback)).not.toContain('SECRET_CANARY');
expect(secondFeedback.reveal_allowed).toBe(true);
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- assessment.test.ts features/assessment/service.test.ts`。
- [ ] **Step 3：实现先答后评。** 保存原始答案后批改；错一次给不泄题追问，第二次后解释；未知判断 needs_review，不强判错。概念／对比／场景题与五种追问及迁移按题逐次交互；练习与诊断不计完成成绩。批改失败后同 attempt 重评，追加评价不覆盖答案。
- [ ] **Step 4：实现确认政策和成绩。** 出题绑定目标技能与政策覆盖，开题前固定题清单；完整分母、整数 80%、部分正确与答案口径按政策。无确认／未答完／不确定均不设 completed；改变目标标旧证据 stale。完成 met 不检查额外成果评分。反馈建议通过总管交给规划师，不能直接调计划。
- [ ] **Step 5：验证泄露与恢复。** HTTP 工作台、事件、档案和导出未揭示秘密不出现；测验中 @ 知识管家要答案被守卫；跨项目／过期题拒绝；重复 submit 不重复答案或批改；题库覆盖不全不能完成。评分与状态测试 PASS，typecheck 成功。
- [ ] **Step 6：提交。** `git add apps/api/src/features/assessment apps/api/src/domain/assessment.ts apps/api/src/domain/assessment.test.ts apps/api/src/agents/coach.ts apps/api/src/agents/prompts.ts apps/api/src/http/projector.ts packages/contracts/src`；`git commit -m "feat: assess learning with immutable evidence and confirmed policies"`。

### Task 8: T08 计划自主调整与目标变更请示

**Files:** 创建 `apps/api/src/domain/goal-impact.ts`、`apps/api/src/domain/goal-impact.test.ts`；修改 `apps/api/src/features/planning/service.ts`、`apps/api/src/features/planning/service.test.ts`、`apps/api/src/agents/project-supervisor.ts`、`apps/api/src/agents/planner.ts`、`packages/contracts/src/commands.ts`。

**Interfaces:**

- `evaluateGoalImpact(constraints:ExplicitConstraint[], proposal:PlanProposal):GoalImpactResult`；结果包含 none／affected／unknown、逐项比较、估计依据和不确定性。
- `PlanningService.proposeAdjustment(ctx:ToolContext, feedbackId:string):Promise<PlanProposalRef>`。
- `activateProposal(ctx:ToolContext, proposalId:string, decisionId?:string):Promise<ArtifactRef>`；仅 planner，提案与 base_plan_version／base_goal_version 必须匹配。
- `recordDecision(ctx:IngressContext,input:DecideProposal):Promise<DecisionRef>`；accept 需要用户确认的 changed_constraints，不能因“接受计划”隐式更改未展示的目标。

- [ ] **Step 1：写失败测试。** 固定明确期限 2026-10-28，提案预估 2026-10-29；另一提案仅替换资料、未改变范围／承诺；缺估计但可能延期的提案。

```ts
expect(evaluateGoalImpact(constraints, lateProposal).impact).toBe('affected');
expect(evaluateGoalImpact(constraints, uncertainProposal).impact).toBe('unknown');
expect(evaluateGoalImpact(constraints, reorderOnly).impact).toBe('none');
expect(projectAfterProposal.deadline).toBe('2026-10-28');
expect(activePlanAfterProposal.version).toBe(originalVersion);
expect(activePlanAfterSafeAdjustment.version).toBe(originalVersion + 1);
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- goal-impact.test.ts features/planning/service.test.ts`。
- [ ] **Step 3：实现比较与生效。** 比较期限、目标技能／范围、每日或其他已确认时间承诺；none 自动激活并群内告知，affected／unknown 只保存提案并等决定。成本估计有依据，不能假设固定低分次数／天数。coach feedback 必须有总管交接事件引用。
- [ ] **Step 4：实现三类决定。** accept 按明确展示的 changed_constraints 建目标新版本并由规划师激活；同一提交将旧完成投影标 stale，原 completed 回到 learning；retain 保留目标重排；pause 保留旧计划和提案。旧提案决定、并发新目标、重复确认不污染新版本；不能降低 80% 门槛解决延期。
- [ ] **Step 5：验证。** 三类决定、无影响调整不请求确认、unknown 保守请示、过期版本拒绝、历史可追踪均 PASS。
- [ ] **Step 6：提交。** `git add apps/api/src/domain/goal-impact.ts apps/api/src/domain/goal-impact.test.ts apps/api/src/features/planning apps/api/src/agents/project-supervisor.ts apps/api/src/agents/planner.ts packages/contracts/src/commands.ts`；`git commit -m "feat: activate safe plan changes and request goal decisions"`。

### Task 9: T09 接入真实群聊工作台

**Files:** 创建文件表中 T09 的 web 文件、`apps/web/src/features/chat/Composer.test.tsx`、`apps/web/src/features/chat/useProjectEvents.test.ts`、`tests/e2e/playwright.config.ts`、`tests/e2e/learning.spec.ts`；修改 `apps/web/src/main.tsx`、`apps/web/package.json`、`packages/contracts/src/commands.ts`。

**Interfaces:**

- `api.getWorkspace(projectId:string):Promise<WorkspaceDTO>`、`api.sendCommand(projectId:string,envelope:CommandEnvelope):Promise<AcceptedCommand>`、`api.getEvents(projectId:string,afterSeq:number):Promise<EventPageDTO>`。
- `useProjectEvents(projectId:string,latestSeq:number):{events:PublicEvent[],status,refresh}`：项目独立 cache、seq 去重、分页追赶、活动／空闲轮询、后台停止。
- `parseMention(text:string,selectedRole?:Role):MentionResult` 放 contracts/commands.ts；冲突与多开头 @ 返回明确错误，原输入原样保存。
- Composer 明确 message／answer 模式；QuestionCard 发 submit_answer，DecisionCard 发 decide_proposal，PolicyCard 显示草案并由用户确认，不后台自动同意。

- [ ] **Step 1：写失败测试。** 两项目切换、网络断开草稿、相同 operation ID 重试、中文输入法 Enter、事件重复补拉与 @ 冲突。

```ts
expect(parseMention('@规划师 帮我调整', 'coach').ok).toBe(false);
expect(parseMention('@知识管家 我卡住了').role).toBe('curator');
expect(deduplicateEvents([event12,event12,event13]).map(e => e.seq)).toEqual([12,13]);
// 组件测试：composition 中 Enter 不调用 send；恢复后显示原待答题。
expect(sendMock).not.toHaveBeenCalled();
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/web -- Composer.test.tsx useProjectEvents.test.ts`；e2e 启动真实本地 Workers+D1，模型／搜索是明确的 deterministic fixtures，运行 `npm run test:e2e -- --grep '项目群聊'`。
- [ ] **Step 3：实现群聊。** 原型交互迁到 React；项目切换、@、独立角色消息、交接卡、等待／失败／暂停与恢复、题目／请示／政策／成绩卡。所有正式记录来自 API，发送中显示待保存；草稿 localStorage 按项目分键，重试复用 ID。运行中按钮仍允许 pause，不能被“正在发送”禁用所有控制。
- [ ] **Step 4：实现公开事件更新。** 活动 2 秒、空闲 15 秒；后台停，重开 workspace 对账并增量补齐。revision 冲突重新读取状态并请用户重试，不静默将旧答案写入新题。游标不跨项目共享。
- [ ] **Step 5：验证浏览器。** 项目创建→定题→资料→计划→首答错→追问→第二答→反馈调整、目标请示、暂停／重开两个项目均通过。320px／375px／1024px／1440px 无横向溢出；对话框焦点、Escape、键盘与减少动画有效。截图存验收目录，测试 PASS，前端 build 成功。
- [ ] **Step 6：提交。** `git add apps/web packages/contracts/src/commands.ts tests/e2e`；`git commit -m "feat: connect project group chat to persistent learning workflows"`。

### Task 10: T10 证据归档、复习周报与用户成果

**Files:** 创建 `apps/api/src/features/archive/service.ts`、`apps/api/src/features/archive/export.ts`、`apps/api/src/features/archive/review.ts`、`apps/api/src/features/archive/archive.test.ts`、`apps/web/src/features/archive/ArchivePanel.tsx`、`apps/web/src/features/archive/ArtifactView.tsx`、`apps/web/src/features/archive/SubmissionCard.tsx`；修改 `apps/api/src/agents/curator.ts`、`apps/api/src/agents/coach.ts`、`apps/api/src/agents/prompts.ts`、`apps/api/src/http/routes.ts`、`packages/contracts/src/commands.ts`、`packages/contracts/src/public.ts`。

**Interfaces:**

- `ArchiveService.createLearningCard(ctx:ToolContext,evidenceIds:string[]):Promise<ArtifactRef>`；每条理解声明包含真实 message／attempt 引用；缺项返回 missing_fields，不扩写理解。
- `scheduleReviews(ctx:ToolContext,input:{skill_id:string,learned_at:string,timezone:string}):Promise<ReviewRef[]>`；`reviewDates(instant:string,timezone:string):{day1:string,day3:string}`。
- `startWeeklyReview(ctx:ToolContext):Promise<PendingInput>`；四个问题逐次收集后 `createWeeklyReport(ctx):Promise<ArtifactRef>`。
- `submitUserArtifact(ctx:IngressContext,input:{kind:'draft'|'final',text:string}):Promise<ArtifactRef>`；`reviewDraft(ctx:ToolContext,draftRef:ArtifactRef):Promise<ArtifactRef>` 只产出审稿意见。
- `exportProject(record:WorkspaceRecord, visibleArtifacts:PublicArtifactDTO[]):string`：按角色卡文件名组织 Markdown，不包含未揭示 secret。

- [ ] **Step 1：写失败测试。** 不完整用户表达、笔记删改权限、午夜日期、错过复习、周报统计复算、原稿保存与 secret 导出防护。

```ts
expect(reviewDates('2026-10-13T16:30:00Z','Asia/Shanghai'))
  .toEqual({day1:'2026-10-15',day3:'2026-10-17'});
expect(cardWithOnePoint.missing_fields).toContain('understood_points');
expect(savedDraft.content).toBe(userDraft); // 保留标点、换行与口语
expect(reviewResult.kind).toBe('review_comments');
expect(exportText).not.toContain('SECRET_CANARY');
expect(report.correct_count).toBe(recomputedCorrectCount);
```

- [ ] **Step 2：运行红灯。** `npm test --workspace apps/api -- archive.test.ts`；`npm run test:e2e -- --grep '归档与成果'`。
- [ ] **Step 3：实现档案与复习。** 知识管家整理证据、笔记新版本／tombstone 与索引，不能改原话与计划；+1／+3 日期按项目时区日历加天，不能直接 UTC 加 24 小时。复习交总管给规划师纳入任务卡；未完成保留，不按未登录推断缺席。
- [ ] **Step 4：实现按需复盘与成果。** 四问逐次回答，周报仅用真实记录。用户独立提交 draft／final，陪练官标具体段落问题、事实核验清单；医法金不出专业结论；知识管家只归档原稿。提供查阅版本与 Markdown 下载，公开 Markdown 不执行 HTML／javascript 链接。
- [ ] **Step 5：验证。** 不补造用户理解、不代写、复算、时区和跨 DST fixture、未揭示答案导出屏蔽、笔记权限与浏览器成果流程全部 PASS。
- [ ] **Step 6：提交。** `git add apps/api/src/features/archive apps/api/src/agents apps/api/src/http apps/web/src/features/archive packages/contracts/src tests/e2e/learning.spec.ts`；`git commit -m "feat: archive learning evidence and schedule project reviews"`。

### Task 11: T11 真实供应商、整体质量与 Cloudflare 发布验收

**Files:** 修改 `apps/api/src/providers/model.ts`、`apps/api/src/providers/search.ts`、`apps/api/src/providers/source-reader.ts`、`apps/api/src/env.ts`、`apps/api/wrangler.jsonc`、`apps/web/wrangler.jsonc`；创建 `apps/api/src/providers/live-adapters.test.ts`、`tests/evals/cases.jsonl`、`docs/deployment.md`、`docs/acceptance.md`。

**Interfaces:**

- 与 T04／T06 的 gateway 接口一致，真实实现与 fixture 不混用；缺少配置返回 CONFIGURATION_REQUIRED。
- `checkReadiness(env:Env):ReadinessResult` 返回 authentication、provider、compatibility、storage、budget readiness；completion readiness 单独依据确认政策，不要求每个新项目先有评分政策才创建。
- eval case 记录 input、role、stage、expected_constraints、source_evidence；结果记录模型版本、运行日期、通过／失败与人工点评，不把 LLM 自评当验收证据。

- [ ] **Step 1：核对实际配置。** 选择并记录模型／搜索、本人身份／域名，集中确认真实评分政策与时间形式；不把文档默认记为用户确认。完成判定未确认则保留禁用，提醒未确认不配置。根据现有授权确认是否可部署，只在授权范围内执行发布。
- [ ] **Step 2：先写适配器失败测试。** fixture HTTP 429／401／超时／畸形结构／用量缺失／D1 不可写；缺少生产鉴权拒绝启动公开服务。

```ts
await expect(gateway.generate(request)).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
expect(successWithoutUsage.usage).toBeNull();
expect(checkReadiness(productionWithoutAuth).authentication).toBe(false);
expect(runAfterFailure.committed_artifacts).toEqual(runBeforeFailure.committed_artifacts);
```

- [ ] **Step 3：运行红灯并实现真实适配。** `npm test --workspace apps/api -- live-adapters.test.ts`；再实现选定服务、secrets、错误映射、预算与已知用量。真实 URL 提取证明公网／重定向限制；缺失能力时使用可验证的受控提取服务，不直接放开任意 fetch。
- [ ] **Step 4：运行整体自动验证。** `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e`，全部成功；核对 A01–A16。mock 测试结果与真实模型质量分栏记录，不写未运行的 PASS。
- [ ] **Step 5：验证真实模型与免费可行性。** 用不少于 12 个精心设计的固定样例覆盖角色权限、先答后评、一次追问、来源支持、开放题不确定、错误概念、目标影响、用户理解缺项、不代写与医法金边界；人工核对输出与引用。重复出现泄题／越权／代写的模型不得上线该功能。测一次建项目全链、一次测验纠错、一次请示，记录 Worker CPU、D1 rows_read／rows_written、DO 和模型／搜索已知用量；免费限额不满足则先提出可验证调整，不自行升级付费。
- [ ] **Step 6：按发布手册部署授权环境。** 按用户 2026-10-14 指示，仅一个 demo 云环境，本地一条命令启动；迁移→API→Web。API 禁公共入口，配置 Access 或已选鉴权，Web 同源转发。Secrets 用 Wrangler secret 配置，不进入代码或输出。保留迁移与应用回滚步骤；回滚不能删除诊断／答题历史。
- [ ] **Step 7：重开线上页面验收并提交。** 登录本人身份，运行两个项目隔离、来源读取、等待作答、80% 证据（已确认政策）、目标请示、暂停重开及搜索失败场景；核对控制台与真实保存记录。docs/acceptance.md 填实际日期、模型／版本、A01–A16 证据、未过项和限制。`git add apps/api/src/providers apps/api/src/env.ts apps/api/wrangler.jsonc apps/web/wrangler.jsonc tests/evals docs/deployment.md docs/acceptance.md`；`git commit -m "feat: validate live providers and Cloudflare deployment"`。配置或验收未完成时记录未完成，不写成已上线。

## 4. 自查与交付标准

- [ ] 技术设计第 11 节的 A01–A16 均有任务与验证入口。
- [ ] 所有跨任务接口在上游 Interfaces 中定义，签名、属性名与具体文件一致。
- [ ] 每个业务任务有失败断言→运行红灯→最小实现→通过验证→独立提交。
- [ ] 五项 Review Focus 各有所属测试，真实模型质量与确定性流程分开验收。
- [ ] 未确认评分／时间／推送／供应商／登录不转成生产默认，未完成配置准确呈现。
- [ ] 文档、原型与应用实现状态区分，线上结果重开核验后才能宣布真实完成。

本次交付这份实施计划与更新后的技术设计，不执行上述编码、安装、提交或部署步骤。建议评审后采用当前会话直接实施：任务共享 repository、状态机与契约，逐项推进更易保持一致；若用户选择子 Agent 模式，再使用规定的 subagent-driven-development 流程执行与审阅。
