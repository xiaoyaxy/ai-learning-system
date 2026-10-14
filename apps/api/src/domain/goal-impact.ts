export interface ExplicitConstraint {
  kind: "deadline" | "scope" | "time";
  raw_text: string;
  value?: string;
}
export interface ImpactProposal {
  estimated_finish: string | null;
  estimate_basis: string;
  potentially_delays: boolean;
  scope_changed: boolean;
  time_commitment_changed: boolean;
  reorder_only: boolean;
}
export function evaluateGoalImpact(
  constraints: ExplicitConstraint[],
  proposal: ImpactProposal,
) {
  const comparisons: string[] = [];
  let impact: "none" | "affected" | "unknown" = "none",
    uncertainty = "";
  if (proposal.scope_changed || proposal.time_commitment_changed) {
    impact = "affected";
    comparisons.push("目标范围或已确认时间承诺发生改变");
  }
  const deadline = constraints.find((c) => c.kind === "deadline")?.value;
  if (deadline && proposal.estimated_finish && proposal.estimate_basis) {
    comparisons.push(
      `原期限 ${deadline}；预估完成 ${proposal.estimated_finish}；依据：${proposal.estimate_basis}`,
    );
    if (proposal.estimated_finish > deadline) impact = "affected";
  }
  if (
    impact === "none" &&
    proposal.potentially_delays &&
    (!deadline || !proposal.estimated_finish || !proposal.estimate_basis)
  ) {
    impact = "unknown";
    uncertainty = "缺少可比较的期限或估计依据，不能确认目标不受影响";
  }
  if (impact === "none" && !proposal.reorder_only) {
    impact = "unknown";
    uncertainty = "调整包含内容变化，需要确认是否影响已有承诺";
  }
  return { impact, comparisons, uncertainty };
}
