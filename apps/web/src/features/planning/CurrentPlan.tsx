import React from "react";
import type { WorkspaceDTO } from "@learning/contracts";
import { ArtifactView } from "../archive/ArtifactView";
export function CurrentPlan({ workspace }: { workspace: WorkspaceDTO }) {
  const plan = workspace.artifacts
    .filter((a) => a.kind === "plan" && !a.tombstone)
    .sort((a, b) => b.version - a.version)[0];
  if (!plan) return null;
  return (
    <details open className="current-plan">
      <summary>规划师已生成学习计划 · v{plan.version}</summary>
      {["scoping", "diagnosis", "preparing"].includes(workspace.phase) && (
        <p>本轮目标正在重新明确，这份已有计划待更新。</p>
      )}
      <ArtifactView artifact={plan} workspace={workspace} />
    </details>
  );
}
