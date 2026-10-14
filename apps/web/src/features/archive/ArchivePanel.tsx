import React, { useState } from "react";
import type {
  WorkspaceDTO,
  ProjectCommand,
  PublicArtifactDTO,
} from "@learning/contracts";
import { artifactNames } from "../../lib/labels";
import { SubmissionCard, type SubmissionKind } from "./SubmissionCard";
export function ArchivePanel({
  workspace: w,
  busy,
  onSend,
  onView,
}: {
  workspace: WorkspaceDTO;
  busy: boolean;
  onSend: (command: ProjectCommand) => Promise<void>;
  onView: (artifact: PublicArtifactDTO) => void;
}) {
  const [submission, setSubmission] = useState<SubmissionKind | null>(null),
    [review, setReview] = useState<string>(),
    [error, setError] = useState("");
  const note = w.artifacts.filter((a) => a.kind === "note").at(-1),
    blocked = busy || w.pending_input?.kind === "answer";
  async function download(e: React.MouseEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await fetch(
        `/api/v1/projects/${encodeURIComponent(w.project.id)}/export`,
        { credentials: "same-origin", signal: AbortSignal.timeout(15000) },
      );
      if (!r.ok) throw new Error("导出未完成，请检查登录或重新连接。");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `learning-${w.project.id}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出未完成");
    }
  }
  return (
    <div className="archive-panel">
      <p>
        原始诊断、独立答案和用户原稿都保留历史。所有正式记录来自已保存的项目事实。
      </p>
      <div className="button-row">
        <button disabled={blocked} onClick={() => setSubmission("learning")}>
          记录学习卡
        </button>
        <button disabled={blocked} onClick={() => setSubmission("draft")}>
          提交初稿
        </button>
        <button disabled={blocked} onClick={() => setSubmission("final")}>
          提交终稿
        </button>
        <button disabled={blocked} onClick={() => setSubmission("note")}>
          保存笔记
        </button>
        {note && !note.tombstone && (
          <button
            disabled={blocked}
            onClick={() =>
              void onSend({
                type: "delete_note",
                note_id: note.id,
                note_version: note.version,
              }).catch((e) => setError(e.message))
            }
          >
            标记删除笔记
          </button>
        )}
      </div>
      <section>
        <h3>文档与版本</h3>
        {w.artifacts
          .filter((a) => a.kind !== "index")
          .map((a) => (
            <button
              key={a.id}
              className="archive-version"
              onClick={() => onView(a)}
            >
              {artifactNames[a.kind] ?? a.kind} · v{a.version}
              {a.tombstone ? " · 删除标记" : ""}
            </button>
          ))}
      </section>
      <section>
        <h3>独立答题记录</h3>
        {w.assessments
          ?.filter((q) => q.purpose !== "weekly_review")
          .map((q) => (
            <details key={q.question_id}>
              <summary>
                {q.prompt} · 目标 v{q.goal_version}
              </summary>
              {q.attempts.map((a) => (
                <div className="answer-record" key={a.id}>
                  <strong>第 {a.index} 答 · 原话</strong>
                  <p className="preserve">{a.text}</p>
                  {a.evaluations.map((ev, i) => (
                    <div key={ev.id}>
                      <small>
                        评价 v{i + 1} ·{" "}
                        {{
                          correct: "正确",
                          incorrect: "仍有缺口",
                          partial: "部分正确",
                          needs_review: "待复核",
                        }[ev.verdict as "correct"] ?? "待复核"}
                      </small>
                      <p className="preserve">{ev.feedback}</p>
                    </div>
                  ))}
                </div>
              ))}
            </details>
          ))}
      </section>
      <section>
        <h3>间隔复习</h3>
        {w.reviews
          ?.filter((r) => r.goal_version === w.project.goal_version)
          .map((r) => (
            <div className="review-row" key={r.id}>
              <p>
                {r.due_date} · {r.form}
              </p>
              <small>
                {r.status === "completed"
                  ? "已有复习表达"
                  : "尚未完成；错过日期仍保留"}
              </small>
              {r.status !== "completed" && (
                <button
                  disabled={blocked}
                  onClick={() => {
                    setReview(r.id);
                    setSubmission("review");
                  }}
                >
                  记录这次复习
                </button>
              )}
            </div>
          ))}
      </section>
      <a
        className="download-link"
        href={`/api/v1/projects/${w.project.id}/export`}
        onClick={download}
      >
        下载 Markdown 档案
      </a>
      {error && <p role="alert">{error}</p>}
      {submission && (
        <SubmissionCard
          kind={submission}
          busy={busy}
          onSend={onSend}
          onClose={() => setSubmission(null)}
          note={note}
          reviewId={review}
        />
      )}
    </div>
  );
}
