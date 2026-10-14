import type { WorkspaceRecord } from "../db/types";
export function buildChatContext(w: WorkspaceRecord): Record<string, unknown> {
  const read = (kind: string, id?: string) => {
    const items = w.artifacts
      .filter((a) => a.kind === kind && (!id || a.id === id))
      .sort((a, b) => b.version - a.version);
    const a = items[0];
    if (!a) return null;
    if (a.content.length > 6000)
      return { excerpt: a.content.slice(0, 6000), truncated: true };
    try {
      return JSON.parse(a.content);
    } catch {
      return null;
    }
  };
  return {
    goal: w.project.goal_text,
    goal_version: w.project.goal_version,
    time_constraint: w.project.time_constraint_text,
    phase: w.project.phase,
    definition: read("definition"),
    active_plan: w.project.active_plan_id
      ? read("plan", w.project.active_plan_id)
      : null,
    today_task: read("task_card"),
    recent_messages: w.messages
      .slice(-8)
      .map((m) => ({ role: m.sender_role, text: m.body.slice(0, 1000) })),
  };
}
