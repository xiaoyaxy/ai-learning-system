import React from "react";
import type { WorkspaceDTO, PublicArtifactDTO } from "@learning/contracts";
import { MaterialLinks } from "../learning/LearningMaterials";
import { latestArtifact, readArtifact } from "../learning/materials";
export function CurrentPlan({
  workspace,
  onView,
}: {
  workspace: WorkspaceDTO;
  onView?: (artifact: PublicArtifactDTO) => void;
}) {
  const plan = workspace.project.active_plan_id
    ? workspace.artifacts.find(
        (a) =>
          a.kind === "plan" &&
          a.id === workspace.project.active_plan_id &&
          !a.tombstone,
      )
    : latestArtifact(workspace, "plan");
  if (!plan) return null;
  const value = readArtifact(plan),
    tasks = Array.isArray(value?.tasks) ? value.tasks : [],
    ids = tasks.flatMap((t: any) => t.material_ids ?? []);
  return (
    <section className="current-plan">
      <strong className="plan-heading">
        规划师已生成学习计划 · v{plan.version}
      </strong>
      {["scoping", "diagnosis", "preparing"].includes(workspace.phase) && (
        <p>本轮目标正在重新明确，这份已有计划待更新。</p>
      )}
      <p>共 {tasks.length} 节课程</p>
      <MaterialLinks ids={ids} workspace={workspace} artifact={plan} compact />
      {onView && (
        <button className="content-link" onClick={() => onView(plan)}>
          查看完整学习计划
        </button>
      )}
    </section>
  );
}
