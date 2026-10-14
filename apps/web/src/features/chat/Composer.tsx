import React, { useRef, useState, useEffect } from "react";
import {
  parseMention,
  type ProjectCommand,
  type Role,
} from "@learning/contracts";
export function Composer({
  projectId,
  busy,
  answer,
  onSend,
}: {
  projectId: string;
  busy: boolean;
  answer: boolean;
  onSend: (c: ProjectCommand) => Promise<void>;
}) {
  const key = `learning:draft:${projectId}`,
    [text, setText] = useState(() => localStorage.getItem(key) ?? ""),
    [role, setRole] = useState<Role | "">(""),
    [mode, setMode] = useState<"message" | "answer">(
      answer ? "answer" : "message",
    ),
    [error, setError] = useState(""),
    composing = useRef(false),
    sending = useRef(false);
  useEffect(() => setMode(answer ? "answer" : "message"), [answer]);
  async function submit() {
    if (busy || sending.current || !text.trim()) return;
    const mention = parseMention(text, role || undefined);
    if (!mention.ok) {
      setError("开头的 @ 与选择的角色冲突，请只指定一位。");
      return;
    }
    if (answer && mode !== "answer") {
      setError("当前有待答题，请切换到回答模式，或使用阶段跳转。");
      return;
    }
    const draftRevision = localStorage.getItem(key + ":revision");
    sending.current = true;
    setError("");
    try {
      await onSend({
        type: "send_message",
        mode,
        text,
        ...(mention.role ? { target_role: mention.role } : {}),
      });
      if (localStorage.getItem(key + ":revision") === draftRevision) {
        setText("");
        localStorage.removeItem(key);
        localStorage.removeItem(key + ":revision");
      }
    } catch {
      setError("发送未完成，草稿已保留。");
    } finally {
      sending.current = false;
    }
  }
  return (
    <div className="composer">
      <label className="sr-only" htmlFor="message">
        消息正文
      </label>
      <textarea
        id="message"
        value={text}
        placeholder={
          answer
            ? "先用自己的话回答，提交后再看反馈…"
            : "给总管发消息，或在开头 @ 一位学习伙伴…"
        }
        maxLength={12000}
        onChange={(e) => {
          setText(e.target.value);
          localStorage.setItem(key, e.target.value);
          localStorage.setItem(key + ":revision", crypto.randomUUID());
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !composing.current &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-footer">
        <label>
          发送给{" "}
          <select
            aria-label="发送给"
            value={role}
            onChange={(e) => setRole(e.target.value as Role | "")}
          >
            <option value="">学务总管 · 自动协调</option>
            <option value="planner">规划师</option>
            <option value="curator">知识管家</option>
            <option value="coach">陪练官</option>
          </select>
        </label>
        <label>
          模式{" "}
          <select
            aria-label="消息模式"
            value={mode}
            onChange={(e) => setMode(e.target.value as "message" | "answer")}
          >
            <option value="message">消息</option>
            <option value="answer">回答</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
        >
          {busy ? "保存中…" : "发送"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <small>Enter 发送 · Shift + Enter 换行 · 草稿按学习群保存</small>
    </div>
  );
}
