import React, { useState } from "react";
import type { ProjectCommand, PublicArtifactDTO } from "@learning/contracts";
import { Dialog } from "../../components/Dialog";
export type SubmissionKind = "draft" | "final" | "note" | "learning" | "review";
export function SubmissionCard({
  kind,
  busy,
  onSend,
  onClose,
  note,
  reviewId,
}: {
  kind: SubmissionKind;
  busy: boolean;
  onSend: (command: ProjectCommand) => Promise<void>;
  onClose: () => void;
  note?: PublicArtifactDTO;
  reviewId?: string;
}) {
  const [text, setText] = useState(
      kind === "note" && !note?.tombstone ? (note?.content ?? "") : "",
    ),
    [fields, setFields] = useState(Array<string>(7).fill("")),
    [error, setError] = useState(""),
    title = {
      draft: "提交初稿",
      final: "提交终稿",
      note: "保存笔记",
      learning: "记录学习卡",
      review: "完成一次复习",
    }[kind];
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          let command: ProjectCommand;
          if (kind === "learning") {
            command = {
              type: "record_learning",
              text: `资料要解决的问题：${fields[0]}\n读懂1：${fields[1]}\n读懂2：${fields[2]}\n读懂3：${fields[3]}\n最有帮助的例子：${fields[4]}\n仍说不清的地方：${fields[5]}`,
            };
          } else if (kind === "note") {
            command = {
              type: "save_note",
              text,
              ...(note
                ? { base_note: { id: note.id, version: note.version } }
                : {}),
            };
          } else if (kind === "review")
            command = { type: "complete_review", review_id: reviewId!, text };
          else
            command = {
              type: kind === "draft" ? "submit_draft" : "submit_final",
              text,
            };
          try {
            await onSend(command);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "保存未完成，原文保留");
          }
        }}
      >
        {kind === "learning" ? (
          [
            "资料要解决的问题",
            "我读懂的第一个点",
            "我读懂的第二个点",
            "我读懂的第三个点",
            "最有帮助的例子",
            "仍说不清的地方",
          ].map((label, i) => (
            <label key={label}>
              {label}
              <textarea
                required
                maxLength={1000}
                value={fields[i]}
                onChange={(e) =>
                  setFields((old) =>
                    old.map((v, k) => (k === i ? e.target.value : v)),
                  )
                }
              />
            </label>
          ))
        ) : (
          <label>
            {kind === "note"
              ? "笔记正文"
              : kind === "review"
                ? "你的复习表达"
                : "你的原稿"}
            <textarea
              autoFocus
              required
              rows={8}
              maxLength={12000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        <p>
          {kind === "draft"
            ? "原稿会完整保存。陪练官只给段落问题和查证清单，由你决定怎么改。"
            : kind === "learning"
              ? "请写自己的真实理解；知识管家只整理，不替你补出三个点。"
              : "原话、标点和换行都会保留。"}
        </p>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {kind === "draft"
            ? "原样提交初稿"
            : kind === "final"
              ? "原样提交终稿"
              : kind === "note"
                ? "保存这个新版本"
                : kind === "review"
                  ? "保存复习表达"
                  : "整理这张学习卡"}
        </button>
      </form>
    </Dialog>
  );
}
