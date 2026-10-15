import React, { useState } from "react";
import { Dialog } from "../../components/Dialog";
export function DeleteProjectDialog({
  project,
  onClose,
  onDelete,
}: {
  project: { id: string; name: string };
  onClose: () => void;
  onDelete: (permanent: boolean, name?: string) => Promise<void> | void;
}) {
  const [permanent, setPermanent] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await onDelete(permanent, permanent ? name : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除未完成");
      setBusy(false);
    }
  }
  return (
    <Dialog title="删除学习群" onClose={() => !busy && onClose()}>
      <p>
        学习群：<strong>{project.name}</strong>
      </p>
      {permanent ? (
        <>
          <p>
            彻底删除会清除这个学习群的消息、资料、计划、笔记和学习记录，无法恢复。
          </p>
          <label>
            输入学习群名称确认
            <input
              aria-label="输入学习群名称确认"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </>
      ) : (
        <p>移到已删除后停止后台任务，保留学习记录，可以恢复。</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="delete-actions">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        {!permanent && (
          <button disabled={busy} onClick={() => setPermanent(true)}>
            彻底删除
          </button>
        )}
        <button
          className={permanent ? "danger" : "primary"}
          disabled={busy || (permanent && name !== project.name)}
          onClick={() => void remove()}
        >
          {busy ? "删除中…" : permanent ? "确认彻底删除" : "移到已删除"}
        </button>
      </div>
    </Dialog>
  );
}
