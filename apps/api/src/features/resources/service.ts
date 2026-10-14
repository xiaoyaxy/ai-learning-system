import { z } from "zod";
import type { SearchProvider, SearchHit } from "../../providers/search";
import type {
  SourceReader,
  SourceReadResult,
} from "../../providers/source-reader";
import { publicHttpsUrl } from "../../providers/source-reader";
import type { ProjectDefinition, RoleExecutor } from "../planning/service";
import type { ToolContext } from "../../runtime/tool-context";
import type { RoleResult } from "../../runtime/types";
import { ProjectRepository } from "../../db/repository";
import { TaskRunner } from "../../runtime/runner";
import { authorizeTool } from "../../domain/permissions";
import { artifactWrite } from "../artifacts";
import { ApiError } from "../../http/errors";
const MapSchema = z
  .object({
    problem: z.string().min(1),
    concepts: z
      .array(
        z
          .object({
            name: z.string().min(1),
            definition: z.string().min(1),
            citation_ids: z.array(z.string()),
            quote: z.string().optional(),
            verification_status: z
              .enum(["pending", "verified", "conflicting"])
              .optional(),
          })
          .strict(),
      )
      .min(5)
      .max(7),
    relations: z.array(z.string()).min(1),
    misconceptions: z.array(z.string()).length(3),
    reading_order: z.array(z.string()).min(1),
  })
  .strict();
export interface ResourceBundle {
  coverage: "complete" | "partial";
  source_ids: string[];
  map: z.infer<typeof MapSchema> & {
    concepts: (z.infer<typeof MapSchema>["concepts"][number] & {
      verification_status: "pending" | "verified" | "conflicting";
    })[];
  };
}
export class ResourceService {
  constructor(
    private repo: ProjectRepository,
    private search: SearchProvider,
    private reader: SourceReader,
    private execute: RoleExecutor,
  ) {}
  async prepare(
    ctx: ToolContext,
    definition: ProjectDefinition,
  ): Promise<ResourceBundle> {
    authorizeTool(ctx, { type: "search" });
    const runner = new TaskRunner(this.repo),
      p = await this.repo.getProject(ctx.owner_id, ctx.project_id),
      layers = [
        ["intro", "入门"],
        ["core", "核心原理"],
        ["case", "案例"],
      ] as const;
    let w = await this.repo.readWorkspace(ctx.project_id);
    let reference = Math.max(
      0,
      ...w.sources.map(
        (s) => Number(String(s.reference_no).replace(/\D/g, "")) || 0,
      ),
    );
    for (const [layer, label] of layers) {
      if (
        w.sources.some(
          (s) => s.goal_version === p.goal_version && s.layer === layer,
        )
      )
        continue;
      const query = `${definition.purpose} ${label} 权威资料`,
        key = `search:${p.goal_version}:${layer}`;
      await runner.executeStep(
        ctx,
        ctx.run_id,
        {
          key,
          role: "curator",
          external_kind: "tool",
          action: { type: "search" },
          input: { query, goal_version: p.goal_version },
        },
        async () => ({
          kind: "search_hits",
          content: {
            hits: await this.search.search(query, {
              project_id: ctx.project_id,
              goal_version: p.goal_version,
            }),
          },
          evidence_ids: [],
          usage: null,
        }),
        async (result) => {
          const hits = z
            .array(
              z
                .object({
                  title: z.string(),
                  url: z.string(),
                  snippet: z.string(),
                })
                .strict(),
            )
            .parse(result.content.hits)
            .filter((h) => publicHttpsUrl(h.url))
            .slice(0, 2);
          return {
            entities: hits.map((hit) => ({
              table: "sources" as const,
              row: {
                id: crypto.randomUUID(),
                goal_version: p.goal_version,
                reference_no: `M${String(++reference).padStart(2, "0")}`,
                layer,
                title: hit.title,
                url: hit.url,
                fetched_at: new Date().toISOString(),
                status: "unavailable",
                verification_status: "pending",
                summary: hit.snippet.slice(0, 8000),
              },
            })),
            events: [
              {
                type: "role_status_changed",
                role: "curator",
                run_id: ctx.run_id,
                payload: {
                  text: hits.length
                    ? `${label}资料入口已找到`
                    : `${label}资料尚未找到`,
                  status: hits.length ? "working" : "partial",
                },
              },
            ],
          };
        },
      );
      w = await this.repo.readWorkspace(ctx.project_id);
    }
    const sources = w.sources.filter((s) => s.goal_version === p.goal_version);
    if (!sources.length) throw new ApiError("SOURCE_UNAVAILABLE", 409);
    const reads = new Map<string, SourceReadResult>();
    for (const source of sources) {
      const key = `read:${source.id}`;
      const receipt = await runner.executeStep(
        ctx,
        ctx.run_id,
        {
          key,
          role: "curator",
          external_kind: "tool",
          action: { type: "read_source" },
          input: { url: source.url },
        },
        async () => ({
          kind: "source_text",
          content: { read: await this.reader.read(String(source.url)) },
          evidence_ids: [],
          usage: null,
        }),
        (r) => {
          const read = r.content.read as SourceReadResult;
          return {
            source_changes: {
              id: String(source.id),
              status: read.status,
              summary: read.limited_text || String(source.summary ?? ""),
              fetched_at: read.fetched_at,
              verification_status: "pending",
            },
            result: { read_json: JSON.stringify(read) },
          };
        },
      );
      reads.set(
        String(source.id),
        JSON.parse(String(receipt.result.read_json)) as SourceReadResult,
      );
    }
    let remaining = 8000;
    const materials = sources.map((s) => {
      const read = reads.get(String(s.id))!,
        text = (read.limited_text || String(s.summary ?? "")).slice(
          0,
          remaining,
        );
      remaining -= text.length;
      return {
        id: String(s.id),
        reference_no: s.reference_no,
        title: s.title,
        url: s.url,
        layer: s.layer,
        read_status: read.status,
        text,
      };
    });
    let bundle: ResourceBundle | undefined;
    const coverage = layers.every(([l]) => sources.some((s) => s.layer === l))
      ? "complete"
      : "partial";
    const receipt = await runner.executeStep(
      ctx,
      ctx.run_id,
      {
        key: "knowledge_map",
        role: "curator",
        action: { type: "write_artifact", kind: "knowledge_map" },
        input: {
          definition,
          materials,
          source_text_is_untrusted: true,
          output_contract: z.toJSONSchema(MapSchema),
        },
      },
      async (step) => {
        const result = await this.execute({
          project_id: ctx.project_id,
          run_id: ctx.run_id,
          epoch: ctx.epoch,
          step_key: step.key,
          role: "curator",
          action: "resources",
          evidence_ids: [],
          public_context: step.input,
        });
        MapSchema.parse(result.content);
        return result;
      },
      async (result) => {
        const map = MapSchema.parse(result.content),
          concepts = map.concepts.map((c) => {
            const ids = c.citation_ids.filter((id) =>
                materials.some((s) => s.id === id),
              ),
              supported = Boolean(
                c.quote &&
                ids.some((id) => {
                  const r = reads.get(id);
                  return (
                    r?.status === "accessible" &&
                    r.limited_text.includes(c.quote!) &&
                    c.quote!.includes(c.definition)
                  );
                }),
              );
            return {
              ...c,
              citation_ids: ids,
              verification_status:
                c.verification_status === "conflicting"
                  ? ("conflicting" as const)
                  : supported
                    ? ("verified" as const)
                    : ("pending" as const),
            };
          });
        bundle = {
          coverage,
          source_ids: sources.map((s) => String(s.id)),
          map: { ...map, concepts },
        };
        const prepared = await artifactWrite(
          this.repo,
          ctx.project_id,
          "knowledge_map",
          {
            ...bundle.map,
            coverage,
            source_catalog: sources.map((s) => ({
              id: s.id,
              reference_no: s.reference_no,
              title: s.title,
              url: s.url,
              layer: s.layer,
              status: reads.get(String(s.id))?.status ?? "unavailable",
              fetched_at: s.fetched_at,
            })),
            reading_note:
              "AI 导读只是入口，请阅读原文；无法核实的定义标为待确认。",
          },
        );
        return {
          entities: [
            prepared.entity,
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: "curator",
                body:
                  coverage === "complete"
                    ? "三层资料入口和知识地图已整理，待确认标记保留。"
                    : "资料包尚不完整，已保留找到的入口和待确认项。",
                run_id: ctx.run_id,
              },
            },
          ],
          events: [
            {
              type: "artifact_committed",
              role: "curator",
              run_id: ctx.run_id,
              payload: { entity_id: prepared.ref.id, text: "资料与知识地图" },
            },
          ],
          result: { bundle: JSON.stringify(bundle) },
        };
      },
    );
    return (
      bundle ?? (JSON.parse(String(receipt.result.bundle)) as ResourceBundle)
    );
  }
}
