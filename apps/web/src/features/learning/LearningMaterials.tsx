import React from "react";
import type { WorkspaceDTO, PublicArtifactDTO } from "@learning/contracts";
import {
  getLearningData,
  resolveMaterials,
  latestArtifact,
  artifactMaterialScope,
  type Lesson,
} from "./materials";
const blockNames: Record<string, string> = {
  deep: "深入学习",
  supplement: "补充巩固",
  reflection: "回忆表达",
};
export function MaterialLinks({
  ids,
  workspace,
  summaries = false,
  compact = false,
  artifact,
}: {
  ids: string[];
  workspace: WorkspaceDTO;
  summaries?: boolean;
  compact?: boolean;
  artifact?: PublicArtifactDTO;
}) {
  const materials = resolveMaterials(
    ids,
    workspace,
    artifactMaterialScope(workspace, artifact),
  );
  return materials.length ? (
    <div
      className={compact ? "material-links compact-links" : "material-links"}
    >
      {materials.map((s) => (
        <section key={s.id}>
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {s.reference_no} · {s.title} ↗
          </a>
          {summaries && s.summary && <p className="preserve">{s.summary}</p>}
          {!compact && (
            <small>
              {new URL(s.url).hostname} ·{" "}
              {s.verification_status === "verified"
                ? "原文已核对"
                : "检索摘要 · 原文待核对"}
            </small>
          )}
        </section>
      ))}
    </div>
  ) : (
    <p className="muted">这节课暂未关联可用资料，请让知识管家补充。</p>
  );
}
export function LearningContent({
  lesson,
  workspace,
  artifact,
  compact = false,
  onOpen,
}: {
  lesson: Lesson;
  compact?: boolean;
  onOpen?: () => void;
  workspace: WorkspaceDTO;
  artifact?: PublicArtifactDTO;
}) {
  if (compact)
    return (
      <div className="compact-learning">
        <p>{lesson.goal}</p>
        <MaterialLinks
          ids={lesson.material_ids}
          workspace={workspace}
          artifact={artifact}
          compact
        />
        {onOpen && (
          <button className="content-link" onClick={onOpen}>
            查看今日学习内容
          </button>
        )}
      </div>
    );
  const { concepts } = getLearningData(workspace),
    materials = resolveMaterials(
      lesson.material_ids,
      workspace,
      artifactMaterialScope(workspace, artifact),
    );
  const ids = new Set(materials.flatMap((s) => [s.id, s.reference_no]));
  const relevant = concepts.filter((c: any) =>
    (c.citation_ids ?? c.citations)?.some((id: string) => ids.has(id)),
  );
  return (
    <div className="learning-content">
      <h3>{lesson.goal}</h3>
      {lesson.blocks?.map((b, i) => (
        <p key={i}>
          <strong>{blockNames[b.kind] ?? b.kind}</strong> · {b.activity}
        </p>
      ))}
      {lesson.output && <p>你的产出：{lesson.output}</p>}
      {relevant.length > 0 && (
        <>
          <h3>学习内容 · 知识管家整理</h3>
          {relevant.map((c: any) => (
            <section key={c.id ?? c.name}>
              <h4>{c.name}</h4>
              <p className="preserve">
                {c.definition ?? c.explanation ?? c.description}
              </p>
            </section>
          ))}
        </>
      )}
      <h3>阅读资料与检索摘要</h3>
      <MaterialLinks
        ids={lesson.material_ids}
        workspace={workspace}
        summaries
        artifact={artifact}
      />
    </div>
  );
}
export function ResourceOverview({
  workspace,
  onCourse,
}: {
  workspace: WorkspaceDTO;
  onCourse: (lesson: Lesson) => void;
}) {
  const { materials, concepts, courses } = getLearningData(workspace);
  if (!materials.length) return null;
  return (
    <section className="resource-overview">
      <h2>知识管家的产出</h2>
      <div className="resource-counts">
        <span>收集 {materials.length} 份材料</span>
        <span>整理 {concepts.length} 个知识点</span>
        <span>安排 {courses.length} 节课程</span>
      </div>
      <small>资料与知识点由知识管家整理，课程由规划师安排。</small>
      <details>
        <summary>查看材料与课程</summary>
        <MaterialLinks ids={materials.map((s) => s.id)} workspace={workspace} />
        <h3>整体课程安排</h3>
        {courses.map((t, i) => (
          <button className="course-link" key={i} onClick={() => onCourse(t)}>
            第{i + 1}课 · {t.goal} <span>查看学习内容 ›</span>
          </button>
        ))}
      </details>
    </section>
  );
}
export function LearningStages({ workspace: w }: { workspace: WorkspaceDTO }) {
  const d = getLearningData(w),
    definition = latestArtifact(w, "definition"),
    today = latestArtifact(w, "task_card");
  const stage = !definition
    ? 0
    : !d.materials.length
      ? 1
      : !d.plan
        ? 2
        : w.pending_input?.kind === "start_learning" || !today
          ? 3
          : 4;
  return (
    <ol className="learning-stages" aria-label="学习步骤">
      {[
        "明确目标",
        "知识管家收集资料",
        "规划师整体计划",
        "总管确认开始",
        "规划师今日安排",
      ].map((s, i) => (
        <li
          key={s}
          aria-current={i === stage ? "step" : undefined}
          className={i < stage ? "done" : i === stage ? "current" : ""}
        >
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}
export function displayTimezone(zone: string) {
  return zone === "Asia/Shanghai" ? "Asia/Beijing" : zone;
}
