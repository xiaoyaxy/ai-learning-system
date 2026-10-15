# 学习资料与学习群管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 显性展示知识管家成果，今日学习可直接阅读内容和打开材料，支持删除学习群，显示 Asia/Beijing。

**Architecture:** 在公开 workspace 投影中提供安全资料目录，从已有知识地图和有效学习计划计算课程、概念和材料统计。今日学习复用已有任务卡／知识地图摘要，不额外调用模型。删除使用独立软删除标记，原子取消运行并提升 epoch，防止旧任务继续写入。显示时区别名，存储仍使用标准 IANA 时区。

**Tech Stack:** React、Hono、Zod、Cloudflare Agents/D1。

**Spec:** 本轮用户需求：1 知识管家产出显性化；2 开始学习和今日计划带学习内容及资料链接；3 学习群删除；4 Asia/Shanghai 显示为 Asia/Beijing。

## Global Constraints

- 当前 codex 分支和目录，单一 Cloudflare demo；沿用已授权部署和 GitHub 同步。
- 不重新生成个人诊断、答案或历史计划；已有项目立即获得资料展示。
- 统计真实保存的材料、计划任务和知识点，不把搜索摘要称作已读取全文。
- 只允许安全 HTTPS 链接；不暴露私有答案、密钥或原始供应商请求。
- 删除区分可恢复和彻底删除；彻底删除需名称确认，清除项目及关联记录与 Agent 状态。停止运行且禁止旧任务提交。

## Review Focus

- 旧项目的资料 ID、引用编号和 URL 匹配；失效 ID 不能编造链接。
- 新旧知识地图版本不能混合统计；优先当前目标和有效计划。
- 删除另一用户的项目、重复删除、删除后的旧 epoch 提交均受保护。
- 删除当前项目后不能继续请求已删 workspace。
- Asia/Beijing 展示不导致 Intl 或复习日期计算错误。

### Task 1: 安全资料目录与材料解析

Files: projector.ts/public.ts、web/features/learning/materials.ts、ArtifactView.tsx；对应测试。
- [x] 先写投影及材料匹配失败测试；实现目录、摘要、版本选择和安全链接；验证通过。

### Task 2: 知识管家成果与今日学习

Files: web/features/learning/LearningMaterials.tsx、App.tsx、styles.css；对应测试。
- [x] 先写统计／今日内容和链接测试；实现成果卡、课程目录、今日学习入口、知识摘要；验证通过。

### Task 3: 可恢复与彻底删除

Files: D1迁移0003、API repository/routes/supervisor、web删除对话框/api/App；对应测试。
- [x] 先写权限／取消／旧任务拒绝测试；实现软删除、恢复、彻底清除和确认界面；验证通过。

### Task 4: 明确协作流程、北京时区显示与上线验收

Files: web/features/learning/LearningMaterials.tsx、App.tsx、docs/acceptance.md。
- [x] 先写流程测试：目标明确后直接收集资料和生成整体计划；总管等待开始确认；用户回复开始或点击后才生成今日安排。保留原始起点诊断作为可选补充。
- [x] 先写别名测试；实现标准时区显示转换；运行全量测试、类型检查和构建。
- [x] 独立审阅；部署迁移和两个 Worker，实测已有资料／今日学习／独立测试项目删除；GitHub同步。

验证与上线证据见 docs/acceptance.md 的本轮更新记录。
