import type { ProjectRepository } from "../db/repository";
import type {
  ArtifactKind,
  ArtifactRef,
  EntityWrite,
  StepContext,
  StepWriteSet,
} from "../db/types";
import { authorizeTool } from "../domain/permissions";
export async function artifactWrite(
  repo: ProjectRepository,
  projectId: string,
  kind: ArtifactKind,
  content: unknown,
  evidenceIds: string[] = [],
): Promise<{ ref: ArtifactRef; entity: EntityWrite }> {
  const w = await repo.readWorkspace(projectId),
    version =
      Math.max(
        0,
        ...w.artifacts.filter((a) => a.kind === kind).map((a) => a.version),
      ) + 1,
    id = crypto.randomUUID();
  return {
    ref: { project_id: projectId, id, kind, version },
    entity: {
      table: "artifacts",
      row: {
        id,
        kind,
        version,
        content:
          typeof content === "string" ? content : JSON.stringify(content),
        evidence_message_ids: JSON.stringify(evidenceIds),
      },
    },
  };
}
export async function commitArtifact(
  repo: ProjectRepository,
  ctx: StepContext,
  kind: ArtifactKind,
  content: unknown,
  evidenceIds: string[],
  extra: StepWriteSet = {},
): Promise<ArtifactRef> {
  authorizeTool(
    { ...ctx, run_id: extra.run_changes?.run_id ?? "" },
    { type: "write_artifact", kind },
  );
  const prior = await repo.readReceipt(
    ctx.project_id,
    ctx.operation_id,
    ctx.step_key,
  );
  if (prior)
    return {
      project_id: ctx.project_id,
      id: String(prior.result.id),
      kind,
      version: Number(prior.result.version),
    };
  const { ref, entity } = await artifactWrite(
      repo,
      ctx.project_id,
      kind,
      content,
      evidenceIds,
    ),
    p = await repo.getProject(ctx.owner_id, ctx.project_id);
  await repo.commitStep(
    { ...ctx, base_revision: p.revision },
    {
      ...extra,
      entities: [entity, ...(extra.entities ?? [])],
      result: { id: ref.id, version: ref.version },
      events: [
        ...(extra.events ?? []),
        {
          type: "artifact_committed",
          role:
            ctx.actor === "trusted_ingress" || ctx.actor === "runtime"
              ? undefined
              : ctx.actor,
          payload: { entity_id: ref.id, text: kind },
        },
      ],
    },
  );
  return ref;
}
