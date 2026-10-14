import type {
  PublicArtifactDTO,
  PublicMaterialDTO,
  WorkspaceDTO,
} from "@learning/contracts";
export interface Lesson {
  goal: string;
  material_ids: string[];
  output?: string;
  skill_id?: string;
  blocks?: { kind: string; activity: string }[];
  date?: string;
}
export function latestArtifact(
  w: WorkspaceDTO,
  kind: string,
): PublicArtifactDTO | undefined {
  return w.artifacts
    .filter((a) => a.kind === kind && !a.tombstone)
    .sort((a, b) => b.version - a.version)[0];
}
export function readArtifact(a: PublicArtifactDTO | undefined): any {
  try {
    return JSON.parse(a?.content ?? "null");
  } catch {
    return null;
  }
}
export function safeMaterialUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function getLearningData(w: WorkspaceDTO) {
  const map = readArtifact(latestArtifact(w, "knowledge_map"));
  const planArtifact =
    w.project.active_plan_id === undefined
      ? latestArtifact(w, "plan")
      : w.artifacts.find(
          (a) =>
            a.kind === "plan" &&
            a.id === w.project.active_plan_id &&
            !a.tombstone,
        );
  const plan = readArtifact(planArtifact);
  const raw = w.materials ?? map?.source_catalog ?? [];
  const materials: PublicMaterialDTO[] = Array.from(
    new Map(
      (Array.isArray(raw) ? raw : [])
        .filter(
          (s: any) =>
            (s.goal_version ?? w.project.goal_version) ===
              w.project.goal_version && safeMaterialUrl(s.url),
        )
        .map((s: any) => [
          s.id,
          {
            id: String(s.id),
            reference_no: String(s.reference_no ?? ""),
            title: String(s.title ?? "学习材料"),
            url: safeMaterialUrl(s.url)!,
            summary: typeof s.summary === "string" ? s.summary : "",
            layer: String(s.layer ?? ""),
            goal_version: w.project.goal_version,
            verification_status: String(s.verification_status ?? "pending"),
          },
        ]),
    ).values(),
  ) as PublicMaterialDTO[];
  const currentMap = materials.some((s) =>
    map?.source_catalog?.some((m: any) => m.id === s.id),
  );
  const concepts =
    currentMap && Array.isArray(map?.concepts) ? map.concepts : [];
  const courses: Lesson[] = Array.isArray(plan?.tasks)
    ? plan.tasks.filter((t: Lesson) =>
        t.material_ids?.some((id) =>
          materials.some(
            (s) => s.id === id || s.reference_no === id || s.url === id,
          ),
        ),
      )
    : [];
  return { materials, courses, concepts, map, plan };
}
export interface MaterialScope {
  goal_version?: number;
  source_ids?: string[];
}
export function artifactMaterialScope(
  w: WorkspaceDTO,
  artifact?: PublicArtifactDTO,
): MaterialScope | undefined {
  if (!artifact) return undefined;
  const value = readArtifact(artifact);
  if (typeof value?.goal_version === "number")
    return { goal_version: value.goal_version };
  if (!artifact.created_at) return undefined;
  const map = w.artifacts
    .filter(
      (a) => a.kind === "knowledge_map" && a.created_at <= artifact.created_at,
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.version - a.version,
    )[0];
  const ids = readArtifact(map)?.source_catalog?.map((s: any) => String(s.id));
  return ids ? { source_ids: ids } : undefined;
}
export function resolveMaterials(
  ids: string[],
  w: WorkspaceDTO,
  scope?: MaterialScope,
): PublicMaterialDTO[] {
  const raw =
    w.materials ??
    w.artifacts
      .filter((a) => a.kind === "knowledge_map")
      .flatMap((a) => readArtifact(a)?.source_catalog ?? []);
  const materials: PublicMaterialDTO[] = (Array.isArray(raw) ? raw : []).filter(
    (s) => safeMaterialUrl(s.url),
  );
  const scoped = scope?.source_ids
    ? materials.filter((s) => scope.source_ids!.includes(s.id))
    : scope?.goal_version !== undefined
      ? materials.filter((s) => s.goal_version === scope.goal_version)
      : materials.filter((s) => s.goal_version === w.project.goal_version);
  return Array.from(
    new Map(
      (ids ?? [])
        .map(
          (id) =>
            materials.find((s) => s.id === id || s.url === id) ??
            scoped.find((s) => s.reference_no === id),
        )
        .filter((s): s is PublicMaterialDTO => !!s)
        .map((s) => [s.id, s]),
    ).values(),
  );
}
export function currentTaskCard(w: WorkspaceDTO) {
  for (const artifact of w.artifacts
    .filter((a) => a.kind === "task_card" && !a.tombstone)
    .sort((a, b) => b.version - a.version)) {
    const lesson = readArtifact(artifact);
    if (
      !lesson ||
      lesson.goal_version === undefined ||
      lesson.plan_id === undefined ||
      (lesson.goal_version !== undefined &&
        lesson.goal_version !== w.project.goal_version) ||
      (lesson.plan_id !== undefined &&
        lesson.plan_id !== w.project.active_plan_id)
    )
      continue;
    if (!resolveMaterials(lesson.material_ids ?? [], w).length) continue;
    return { artifact, lesson: lesson as Lesson };
  }
  return null;
}
export function localDate(zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
