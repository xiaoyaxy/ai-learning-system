# 实施决策与审阅记录

当前目标为可快速运行的 demo：一个本地启动命令、一个 Cloudflare 云环境，无 staging／production。最新指示要求真实 DeepSeek、Tavily 和云端部署；本地真实计划生成链路已验证，云端已部署，已采用用户选择的 demo 访问密码。

## Final review

独立只读整分支审阅发现0个Critical、4个Important、2个Minor。4个Important已通过失败复现→修复→全量验证：控制命令原子提交，多步消息恢复，笔记原操作重试，多项目视口布局（含截图发现的项目行压缩，并追加失败复现→通过检查）。最终 typecheck、103项自动测试、build／Wrangler dry-run、9项浏览器流程通过；没有第二次审阅。

## Rulings I made

- Ruling: Normalize task headings to Task 1: T01 etc. — skill task-start parser requires numeric headings — no product impact.
- Ruling: Use bundled Node 24 LTS for development, engines >=22 — installed default is odd Node 23; Workers runtime remains unchanged — verify lock/runtime compatibility.
- Task 1: Ruling: task-start could not execute non-executable bundled task-brief; invoke same task-brief through bash and record BASE cf5df9d — same extraction, no skill file edits.
- Task 1: Ruling: npm10 arborist crashes in vitest peer graph; try temporary npm11 rather than silently bypass peer compatibility. Agents0.28 retains deprecated subAgent RPC; use supported dynamicAgents.get with compatibility test after verification.
- Task 1: Ruling: old vitest-pool-workers0.23 frozen August runtime rejects October compatibility date; replace with official vitest-plugin1.4.1 (supports Vitest4.1), then verify actual binary maximum date.
- Task 1: Ruling: registry mirror lacks wrangler4.150 dependency of plugin1.4.1; pin plugin1.4.0 with available wrangler4.149/miniflare5.20261006.1 and keep supported Vitest4.1.
- Task 1: Ruling: latest installed workerd supports at most 2026-10-13; pin both Workers and test runtime to that verified date, update spec/plan engineering constraint — one day older compatibility semantics, tested RPC and schedule.
- Task 5: Ruling: implement shared mention parsing ahead of T09 because backend dispatch must honor textual @ immediately; original saved message and command envelope remain unchanged.
- Task 6: Ruling: source reads require a verified pinned-public-egress transport; no arbitrary fetch is enabled by default. Search snippets and links remain usable with pending verification. Real transport capability belongs to T11 live readiness, not a false safety claim. External search/read steps consume tool budget, not model or role-handoff budget.
- Task 8: Ruling: changed learning goals return to scoping rather than reusing the old definition in learning — prevents assessing old skills against a new goal; time-only changes retain learning. Unknown timing is shown explicitly; accept does not alter undisplayed constraints. Cost if wrong: an additional goal-scoping interaction.
- Task 9: Ruling: add local-only deterministic model/search adapters before T11 so browser tests exercise real Workers, native Agents and D1 — DEMO_MODE is honored only in local; no fake provider results in staging/production. Cost if wrong: fixture output-contract drift; covered by full browser flow.
- Task 9: Ruling: UI skill searches returned landing-page layouts; retain verified existing prototype structure and its indigo role palette, apply matched flat styling and React focus/input guidance — no persisted mismatched design-system output. Cost if wrong: a later visual-layout revision.
- Task 9: Ruling: pin Playwright1.60.0/Chromium148.0.7778.96 after Chromium156 from1.64 blocked requestAnimationFrame and screenshots on a minimal blank page; matching1223 browser metadata verified — no forced clicks or skipped UI tests. Cost if wrong: later browser-test upgrade and revalidation.
- Task 10: Ruling: learning-card result explicitly includes missing_fields when learner evidence is incomplete; no fabricated ArtifactRef — matches the brief's missing-fields test and requirements; callers inspect saved artifacts for actual completion. Cost if wrong: internal result-shape adjustment.
- Task 10: Ruling: weekly report shows four actual reflections plus explicitly labeled cumulative project first-answer statistics — no implied weekly time filter or mastery rate; each figure has attempt IDs. Cost if wrong: add a user-selected reporting window.
- Task 10: Ruling: add explicit reassess_answer for needs_review and append superseding evaluations — unblocks uncertainty without editing answers; replay reuses one receipt. Cost if wrong: additional manually requested model use, still within per-run budget.
- Task 11: Ruling: User explicitly wants the simplest runnable demo: remove staging/production configs, deployment scripts and operator quality flag; one cloud environment, one npm run demo local entry. Authentication remains required for public personal data. Cost if wrong: add environments later.
- Task 11: Ruling: No cloud credentials or model/search selection supplied; finish runnable local code and configurable live adapters, record real-model quality and cloud deployment as not run. Full-text transport remains disabled; safe links/search snippets are available. Cost if wrong: real-provider behavior needs later validation.
- Task 11: Ruling: Correction-basis completion waits for a wrong/partial first answer to receive its second attempt; new completion sessions clear prior met projection. Cost if wrong: one more correction interaction, covered by evidence tests.
- Task 11: Ruling: GitHub code writes are authorized but OAuth lacks workflow scope; workflow tree fails404 while same tree without workflow succeeds. Keep CI as docs/ci.example.yml, do not request extra login for demo delivery. Cost if wrong: activate the template later with workflow permission.
- Final: Ruling: Real model teaching/search citation quality is outside observed validation — adapters and manual cases remain configurable, no real-quality PASS asserted — cost if wrong: provider-specific defects await live testing.
- Final: Ruling: Cloud deployment/CPU/quotas and separate infrastructure are not required for this code/demo scope — user explicitly requests the simplest demo, no cloud configuration supplied — cost if wrong: deployment and quota testing remain later work.
- Final: Ruling: Arbitrary full-text fetching remains disabled — users receive search links/snippets with verification status — cost if wrong: unavailable full-page context.
- Final: Ruling: CI template relocation is outside reviewer Head but contains unchanged YAML and creates no executable workflow — avoids missing OAuth workflow permission — cost if wrong: template activation later needs validation.
- Final: Ruling: User authorized public GitHub code and chose codex branch — push branch and create draft PR without merging main — cost if wrong: user can close PR; main unchanged.

## Deferred minors

- Cloud authentication expiry is shown as connection interruption with cached workspace; add explicit login recovery before broader cloud use.
- Markdown export should reject a login page returned as HTML200; current local demo has no authentication redirect.

## 后续接入与部署

2026-10-14：用户提供 DeepSeek 与 Tavily 配置，并明确要求部署到 Cloudflare。此前“云部署不在本轮范围”的决策已被最新指示替代。密钥仅保存在忽略的服务端文件，云端将使用 Cloudflare Secrets。已通过109项自动测试、typecheck、build与9项隔离浏览器流程；真实链路另生成了定义、知识地图、5项任务计划和任务卡。Cloudflare 现有 OAuth 过期，授权页面已交给用户登录。

### 云端部署最终变更

用户明确选择无需银行卡的 demo 访问密码。实现12小时安全 Cookie，固定单人身份；Cloudflare Access 仍可作为替代配置。Default Wrangler OAuth 请求30项权限被自动审批拒绝，随后成功使用账号读取、Workers部署与D1等6项必要权限完成连接。

真实远程迁移发现 D1 query parser 将触发器内的 CASE END 误认为触发器结束；同一探测先失败、等价 SELECT RAISE WHERE 成功。已替换两处守卫，远程迁移和24个保护触发器安装成功，清理了空探测表；本地23项数据库／恢复测试通过。

真实 DeepSeek 响应还出现错误外层类型和一个多余右括号。完整内容先按生成的 JSON Schema 校验，类型由服务器固定；语法修复仅允许完成响应的单个重复结构括号、最多32个候选且唯一结果，不改字符串内容。实际失败响应离线回放通过，117项自动测试、typecheck通过；已重新上传 API。

最终线上验收通过：密码登录、配置 readiness、真实 DeepSeek／Tavily 链路、6项任务计划与任务卡、6条搜索资料持久化，以及浏览器刷新后计划展示。当前 API 版本 b2c2059c-28ed-4e87-8297-bd59fbab0c74，Web 版本 e98d5764-b6db-49d2-84ce-3f7e3acb52c3。截图仅保留本地，不提交密码或个人数据。
