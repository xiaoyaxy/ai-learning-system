import React, { useRef, useEffect } from "react";
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector<HTMLInputElement>("input, textarea")?.focus();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog aria-label={title} ref={ref} onCancel={onClose}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button aria-label="关闭对话框" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
