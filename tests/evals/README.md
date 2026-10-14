# 真实模型人工检查样例

cases.jsonl 含 14 个固定场景，尚未用真实模型运行。固定演示回复或 LLM 自评分数不能替代人工判断。

接入选定模型后，在 demo 新项目按场景建立相应阶段与证据，保存实际输入／输出、模型准确版本、日期和来源，再人工对照 expected_constraints。评分场景必须先由用户确认项目政策；未确认不得自动完成。

结果保存在被 gitignore 排除的 `tests/evals/results/`，每条 JSON 记录：case_id、model、provider、run_date、actual_input、actual_output、source_evidence、verdict（pass/fail/uncertain）、human_comment。未运行的场景 verdict 为 not_run，不填通过。真实答案与个人资料不提交公共仓库。

重点看泄题、越权、虚构引用、代写、强判不确定答案、为期限降低门槛。重复失败时调整提示／选定模型并保留失败记录。实际调用可能消耗供应商额度。
