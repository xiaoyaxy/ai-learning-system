import { MaterialLinks } from "../learning/LearningMaterials";
import React from "react";
import type { PublicArtifactDTO, WorkspaceDTO } from "@learning/contracts";
export function ArtifactView({
  artifact,
  workspace,
}: {
  artifact: PublicArtifactDTO;
  workspace?: WorkspaceDTO;
}) {
  if (artifact.tombstone) return <p>这个版本标记为删除，历史版本仍可查阅。</p>;
  if (["diagnosis", "note", "draft", "final"].includes(artifact.kind))
    return <div className="document-text">{artifact.content}</div>;
  let v: any;
  try {
    v = JSON.parse(artifact.content);
  } catch {
    return <div className="document-text">{artifact.content}</div>;
  }
  const list = (items: any[]) => (
    <ul>
      {items?.map((x, i) => (
        <li key={i}>{typeof x === "string" ? x : x.text}</li>
      ))}
    </ul>
  );
  if (artifact.kind === "definition")
    return (
      <div className="artifact-document">
        <h3>{v.purpose}</h3>
        <h4>本轮学什么</h4>
        {list(v.scope_in)}
        <h4>本轮不学什么</h4>
        {list(v.scope_out)}
        <h4>需要掌握的技能</h4>
        {list(v.skills)}
        <h4>第一版成果方向</h4>
        <p>{v.first_draft_milestone?.description}</p>
        <small>
          建议 {v.first_draft_milestone?.suggested_days}{" "}
          天；具体时间保留你的约束
        </small>
      </div>
    );
  if (artifact.kind === "plan")
    return (
      <div className="artifact-document">
        <h3>学习里程碑</h3>
        {list(v.milestones)}
        {v.tasks?.map((t: any, i: number) => (
          <section key={i}>
            <h4>
              {i + 1}. {t.goal}
            </h4>
            <p>技能：{t.skill_id}</p>
            <p>你的产出：{t.output}</p>
            <Materials
              ids={t.material_ids}
              workspace={workspace}
              artifact={artifact}
            />
          </section>
        ))}
        <p>时间约束：{v.time_constraint_text || "待明确"}</p>
      </div>
    );
  if (artifact.kind === "task_card")
    return (
      <div className="artifact-document">
        <h3>{v.goal}</h3>
        <p>{v.date}</p>
        {v.blocks?.map((b: any) => (
          <section key={b.kind}>
            <h4>
              {
                {
                  deep: "深入学习",
                  supplement: "补充巩固",
                  reflection: "回忆表达",
                }[b.kind as "deep"]
              }
            </h4>
            <p>{b.activity}</p>
          </section>
        ))}
        <p>你的产出：{v.output}</p>
        <Materials
          ids={v.material_ids}
          workspace={workspace}
          artifact={artifact}
        />
        {v.review_ids?.length > 0 && (
          <>
            <h4>到期复习</h4>
            {v.review_ids.map((id: string) => {
              const r = workspace?.reviews?.find((r) => r.id === id);
              return (
                <p key={id}>
                  {r?.form ?? "复习记录"} · {r?.due_date}
                </p>
              );
            })}
          </>
        )}
      </div>
    );
  if (artifact.kind === "knowledge_map")
    return (
      <div className="artifact-document">
        <h3>{v.problem}</h3>
        <p>AI 整理是阅读入口，请阅读原文并核对待确认内容。</p>
        {v.concepts?.map((c: any, i: number) => (
          <section key={i}>
            <h4>
              {c.name}{" "}
              <small>
                {c.verification_status === "verified"
                  ? "原文支持已核对"
                  : "待确认"}
              </small>
            </h4>
            <p>{c.definition}</p>
          </section>
        ))}
        <h4>概念关系</h4>
        {list(v.relations)}
        <h4>常见误解</h4>
        {list(v.misconceptions)}
        <h4>资料入口</h4>
        <Sources sources={v.source_catalog} />
      </div>
    );
  if (artifact.kind === "learning_card")
    return (
      <div className="artifact-document">
        {[
          ["资料解决的问题", v.problem],
          ["我读懂的三个点", v.understood_points],
          ["最有帮助的例子", v.helpful_example],
          ["仍说不清的地方", v.unclear],
        ].map(([label, content]: any) => (
          <section key={label}>
            <h4>{label}</h4>
            {Array.isArray(content) ? list(content) : <p>{content?.text}</p>}
          </section>
        ))}
        <small>{v.claim_basis}</small>
        <details>
          <summary>查看原话引用</summary>
          {[
            v.problem,
            ...v.understood_points,
            v.helpful_example,
            v.unclear,
          ].map((q: any, i: number) => (
            <p key={i}>
              {q?.message_id} · {q?.text}
            </p>
          ))}
        </details>
      </div>
    );
  if (artifact.kind === "review_comments")
    return (
      <div className="artifact-document">
        <p>{v.boundary}</p>
        {v.comments?.map((c: any, i: number) => (
          <section key={i}>
            <h4>第 {c.paragraph_index} 段</h4>
            <blockquote>{c.quote}</blockquote>
            <p>问题：{c.issue}</p>
            <p>可以做：{c.action}</p>
          </section>
        ))}
        <h4>需人工查证</h4>
        {v.fact_checks?.length ? (
          v.fact_checks.map((f: any, i: number) => (
            <section key={i}>
              <blockquote>{f.quote}</blockquote>
              <p>{f.reason}</p>
              <small>需人工查证</small>
            </section>
          ))
        ) : (
          <p>暂无已列出的查证项。</p>
        )}
      </div>
    );
  if (artifact.kind === "weekly_report")
    return (
      <div className="artifact-document">
        {v.answers?.map((a: any, i: number) => (
          <section key={i}>
            <h4>{a.prompt}</h4>
            <p className="preserve">{a.text}</p>
          </section>
        ))}
        <h4>此学习项目累计答题统计</h4>
        <p>
          第一答正确 {v.correct_count}；错误 {v.incorrect_count}；部分正确{" "}
          {v.partial_count}；待复核 {v.needs_review_count}
        </p>
        <small>{v.basis}</small>
        <details>
          <summary>查看可复算记录</summary>
          {v.attempt_ids?.map((id: string) => (
            <p key={id}>{id}</p>
          ))}
        </details>
      </div>
    );
  return <pre>{JSON.stringify(v, null, 2)}</pre>;
}
function Sources({ sources }: { sources: any[] }) {
  return (
    <div>
      {sources?.map((s: any) => {
        let href: string | undefined;
        try {
          const u = new URL(s.url);
          if (u.protocol === "https:" && !u.username && !u.password)
            href = u.href;
        } catch {}
        return (
          <section key={s.id}>
            <p>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  资料 {s.reference_no} · {s.title}
                </a>
              ) : (
                s.title
              )}
            </p>
            <small>
              {href ? new URL(href).hostname : ""} ·{" "}
              {s.verification_status === "verified" ? "已核对" : "待核对"} ·{" "}
              {s.status}
            </small>
          </section>
        );
      })}
    </div>
  );
}
function Materials({
  ids,
  workspace,
  artifact,
}: {
  ids: string[];
  workspace?: WorkspaceDTO;
  artifact?: PublicArtifactDTO;
}) {
  return workspace ? (
    <MaterialLinks
      ids={ids}
      workspace={workspace}
      artifact={artifact}
      summaries
    />
  ) : (
    <small>请打开学习群查看对应资料。</small>
  );
}
