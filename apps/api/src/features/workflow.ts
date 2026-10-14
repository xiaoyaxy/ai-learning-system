import { ResourceService } from "./resources/service";
import { ConfiguredSearchProvider } from "../providers/search";
import { UnconfiguredSourceReader } from "../providers/source-reader";
import type { Env } from "../env";
import type { RunRecord, IngressContext } from "../db/types";
import type { CommandEnvelope } from "@learning/contracts";
import { ProjectRepository } from "../db/repository";
import type { RoleExecutor } from "./planning/service";
import { PlanningService } from "./planning/service";
import { ApiError } from "../http/errors";
import { AssessmentService } from "./assessment/service";
import { toWorkspaceDTO } from "../http/projector";
export async function runLearningCommand(
  repo: ProjectRepository,
  ctx: IngressContext,
  run: RunRecord,
  execute: RoleExecutor,
  command: CommandEnvelope["command"],
  environment?: Env,
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
  const assessment = new AssessmentService(repo, execute),
    coachCtx = { ...toolCtx, actor: "coach" as const };
  if (
    command.type === "start_practice" ||
    command.type === "start_completion_check"
  ) {
    await assessment.start(
      coachCtx,
      command.type === "start_practice" ? "practice" : "completion",
    );
    return true;
  }
  if (command.type === "confirm_assessment_policy") {
    await assessment.confirmPolicy(coachCtx, command);
    return true;
  }
  if (
    command.type === "submit_answer" ||
    (command.type === "send_message" && command.mode === "answer")
  ) {
    if (
      command.type === "send_message" &&
      command.target_role &&
      command.target_role !== "coach" &&
      command.target_role !== "supervisor"
    )
      throw new ApiError("ANSWER_PENDING", 409);
    const q = toWorkspaceDTO(w).question;
    // Replayed runs can already have saved their answer while evaluation is pending.
    const previous = w.attempts.find((a) =>
      w.messages.some(
        (m) => m.id === a.answer_message_id && m.run_id === run.id,
      ),
    );
    const input =
      command.type === "submit_answer"
        ? command
        : q
          ? {
              question_id: q.id,
              question_version: q.version,
              attempt_index: q.attempt_index,
              text: command.text,
            }
          : previous
            ? {
                question_id: String(previous.question_id),
                question_version: 1,
                attempt_index: Number(previous.attempt_index),
                text: command.text,
              }
            : null;
    if (!input) throw new ApiError("INVALID_STAGE", 409);
    const attempt = await assessment.submit(coachCtx, input);
    await assessment.evaluate(coachCtx, attempt);
    return true;
  }
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
    if (environment) await prepareProject(repo, ctx, run, execute, environment);
    return true;
  }
  if (
    command.type === "send_message" &&
    w.project.phase === "preparing" &&
    environment
  ) {
    await prepareProject(repo, ctx, run, execute, environment);
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

async function prepareProject(
  repo: ProjectRepository,
  ctx: IngressContext,
  run: RunRecord,
  execute: RoleExecutor,
  environment: Env,
) {
  const w = await repo.readWorkspace(ctx.project_id),
    definition = w.artifacts.filter((a) => a.kind === "definition").at(-1);
  if (!definition) throw new ApiError("INVALID_STAGE", 409);
  const base = {
    ...ctx,
    operation_id: run.operation_id,
    step_key: "prepare",
    base_revision: w.project.revision,
    epoch: run.epoch,
    run_id: run.id,
  };
  const bundle = await new ResourceService(
    repo,
    new ConfiguredSearchProvider(environment),
    new UnconfiguredSourceReader(),
    execute,
  ).prepare({ ...base, actor: "curator" }, JSON.parse(definition.content));
  const planner = new PlanningService(repo, execute);
  await planner.createPlan(
    { ...base, actor: "planner" },
    {
      definition_id: definition.id,
      source_ids: bundle.source_ids,
      review_ids: [],
    },
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: w.project.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()),
    date = ["year", "month", "day"]
      .map((k) => parts.find((p) => p.type === k)!.value)
      .join("-");
  await planner.createTaskCard({ ...base, actor: "planner" }, date);
}
