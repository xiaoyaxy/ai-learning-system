import type { RunRecord, IngressContext } from "../db/types";
import type { CommandEnvelope } from "@learning/contracts";
import { ProjectRepository } from "../db/repository";
import type { RoleExecutor } from "./planning/service";
import { PlanningService } from "./planning/service";
import { ApiError } from "../http/errors";
export async function runLearningCommand(
  repo: ProjectRepository,
  ctx: IngressContext,
  run: RunRecord,
  execute: RoleExecutor,
  command: CommandEnvelope["command"],
): Promise<boolean> {
  const w = await repo.readWorkspace(ctx.project_id),
    message = w.messages.find(
      (m) => m.run_id === run.id && m.sender_role === "user",
    ),
    planner = new PlanningService(repo, execute),
    toolCtx = {
      ...ctx,
      operation_id: run.operation_id,
      step_key: "planning",
      base_revision: w.project.revision,
      epoch: run.epoch,
      actor: "planner" as const,
      run_id: run.id,
    };
  if (
    command.type === "send_message" &&
    w.project.phase === "scoping" &&
    (!command.target_role ||
      ["supervisor", "planner"].includes(command.target_role))
  ) {
    if (!message) throw new ApiError("INVALID_STAGE", 409);
    await planner.scope(toolCtx, { message_id: message.id });
    return true;
  }
  if (
    command.type === "submit_diagnosis" ||
    (command.type === "send_message" &&
      w.project.phase === "diagnosis" &&
      !command.target_role)
  ) {
    if (!message) throw new ApiError("INVALID_STAGE", 409);
    await planner.saveDiagnosis(toolCtx, message.id);
    return true;
  }
  if (command.type === "start_learning") {
    if (w.project.phase !== "learning")
      throw new ApiError("INVALID_STAGE", 409);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: w.project.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date()),
      date = ["year", "month", "day"]
        .map((k) => parts.find((p) => p.type === k)!.value)
        .join("-");
    await planner.createTaskCard(toolCtx, date);
    return true;
  }
  return false;
}
