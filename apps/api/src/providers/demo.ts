// Explicit local-only deterministic data for development and browser tests. Not AI output.
import type { RoleTask, RoleResult } from "../runtime/types";
export function demoResult(task: RoleTask): RoleResult {
  const x = task.public_context;
  let content: Record<string, unknown>;
  const definition = {
    purpose: "理解 AI Agent 并独立解释其架构",
    scope_in: ["Agent 与工具", "协调与记忆"],
    scope_out: ["生产系统部署"],
    skills: ["concept"],
    first_draft_milestone: {
      suggested_days: 2,
      description: "独立画出学习助手的结构",
    },
  };
  switch (task.action) {
    case "scope":
      content = { kind: "definition", definition };
      break;
    case "plan": {
      const materials = x.materials as { id: string }[];
      content = {
        milestones: ["理解基本结构", "独立解释与检验"],
        tasks: [
          {
            goal: "区分 Agent 与工具",
            skill_id: "concept",
            material_ids: materials.map((m) => m.id).slice(0, 2),
            output: "用自己的话解释区别",
          },
        ],
      };
      break;
    }
    case "task_card": {
      const p = x.plan as any;
      content = {
        goal: "用自己的话区分 Agent 与工具",
        material_ids: p.tasks[0].material_ids,
        output: "一段独立解释",
        blocks: [
          { kind: "deep", activity: "阅读入门资料，画出概念关系" },
          { kind: "supplement", activity: "比较一个 Agent 与固定工作流案例" },
          { kind: "reflection", activity: "合上资料，解释你现在理解的区别" },
        ],
      };
      break;
    }
    case "resources": {
      const materials = x.materials as { id: string }[] | undefined;
      const ids = (materials ?? []).map((m) => m.id);
      content = {
        problem: "Agent 如何协调目标与工具",
        concepts: ["目标", "Agent", "工具", "记忆", "反馈"].map((name) => ({
          name,
          definition: `演示概念：${name}，请核对真实资料`,
          citation_ids: ids.slice(0, 1),
          verification_status: "pending",
        })),
        relations: ["目标驱动决策，工具执行操作，反馈修正路径"],
        misconceptions: [
          "工具本身等于 Agent",
          "所有任务都需要多 Agent",
          "记忆等于可靠事实",
        ],
        reading_order: ids.length ? ids : ["M01"],
      };
      break;
    }
    case "assessment_policy":
      content = {
        question_count: 5,
        required_skill_ids: ["concept"],
        rubric: {
          correct_criteria: ["能独立区分 Agent 的决策职责与工具的执行职责"],
          uncertain_rule: "needs_review",
        },
        partial_rule: "count_incorrect",
        attempt_basis: "first",
        aggregation: "single_session",
        session_count: 1,
      };
      break;
    case "questions":
      content = {
        questions: (x.questions as any[]).map((q) => ({
          prompt:
            q.kind === "application"
              ? "如何把 Agent 用在一个学习助手中？"
              : "Agent 与工具有什么区别？请用自己的话解释。",
          reference_answer: "Agent 围绕目标作出决策，工具执行具体操作。",
          explanation:
            "参考解释（演示）：Agent 围绕目标决策，工具负责具体操作。",
          rubric: { criteria: ["区分决策与执行"] },
        })),
      };
      break;
    case "evaluate": {
      const answer = String(x.answer);
      content = {
        verdict: answer.includes("需要复核")
          ? "needs_review"
          : answer.includes("决策") && answer.includes("执行")
            ? "correct"
            : "incorrect",
        gap_category: "concept_confusion",
        gap: "演示判断",
        evidence_quote: answer,
      };
      break;
    }
    case "adjustment": {
      const p = x.active_plan as any,
        late = (x.constraints as any[]).some((c) =>
          String(c.raw_text).includes("延期演示"),
        );
      content = {
        plan: p,
        changed_constraints: late
          ? [{ kind: "time", raw_text: "2026-10-29" }]
          : [],
        estimated_finish: late ? "2026-10-29" : null,
        estimate_basis: late
          ? "本地测试：补充练习增加一天"
          : "相同目标和任务，仅重排材料",
        potentially_delays: late,
        summary: late
          ? "本地测试提案：增加一天巩固练习，会影响原期限"
          : "依据本次表达，先复习概念区别再进入应用",
      };
      break;
    }
    case "learning_card": {
      const m = (x.evidence as { id: string; text: string }[])[0],
        field = (label: string) => {
          const value = new RegExp("(?:^|\\n)" + label + "：([^\\n]*)").exec(
            m.text,
          )?.[1];
          return value ? { text: value, message_id: m.id } : null;
        };
      content = {
        problem: field("资料要解决的问题"),
        understood_points: [
          field("读懂1"),
          field("读懂2"),
          field("读懂3"),
        ].filter(Boolean),
        helpful_example: field("最有帮助的例子"),
        unclear: field("仍说不清的地方"),
        skill_id: (x.skills as string[])[0] ?? "concept",
      };
      break;
    }
    case "review_draft": {
      const paragraphs = x.paragraphs as { index: number; text: string }[],
        p = paragraphs[0],
        quote = p.text.slice(0, Math.min(12, p.text.length));
      content = {
        comments: [
          {
            paragraph_index: p.index,
            quote,
            issue: "演示：论点还需要具体例子",
            action: "补充一个你亲自观察的例子，不需要照抄资料",
          },
        ],
        fact_checks: [
          {
            quote,
            reason: "演示：涉及版本、数据或专业内容时，核对可靠原始来源",
            status: "needs_manual_verification",
          },
        ],
      };
      break;
    }
    case "route":
      content = { role: "coach" };
      break;
    case "message":
      content = {
        text: "本地演示模式：请先说明自己的理解，再进行独立练习。正式 AI 需要设置模型和搜索供应商。",
      };
      break;
    default:
      content = { text: "本地演示步骤尚未配置" };
  }
  return {
    kind: task.action,
    content,
    evidence_ids: task.evidence_ids,
    usage: null,
  };
}
