import { ApiError } from "../http/errors";
import type { ToolContext } from "../runtime/tool-context";
import type { ArtifactKind } from "../db/types";
export type ToolAction =
  | { type: "write_artifact"; kind: ArtifactKind }
  | {
      type:
        | "activate_plan"
        | "propose_plan"
        | "search"
        | "read_source"
        | "present_question"
        | "grade_answer"
        | "route"
        | "control_run"
        | "record_answer"
        | "submit_user"
        | "set_goal"
        | "schedule_review";
    };
const kinds = {
  supervisor: [],
  planner: ["definition", "diagnosis", "plan", "task_card"],
  curator: ["knowledge_map", "learning_card", "note", "index", "weekly_report"],
  coach: ["review_comments"],
  trusted_ingress: ["draft", "final"],
  runtime: [],
} as Record<string, string[]>;
const tools = {
  supervisor: ["route", "control_run"],
  planner: ["activate_plan", "propose_plan"],
  curator: ["search", "read_source", "schedule_review"],
  coach: ["present_question", "grade_answer"],
  trusted_ingress: ["record_answer", "submit_user", "set_goal"],
  runtime: ["control_run"],
} as Record<string, string[]>;
export function authorizeTool(ctx: ToolContext, action: ToolAction) {
  const allowed =
    action.type === "write_artifact"
      ? kinds[ctx.actor]?.includes(action.kind)
      : tools[ctx.actor]?.includes(action.type);
  if (!allowed) throw new ApiError("FORBIDDEN", 403);
}
