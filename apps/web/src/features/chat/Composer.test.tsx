import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("preserves Chinese composition and submits only after composition ends", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  render(<Composer projectId="p" busy={false} answer={false} onSend={send} />);
  const input = screen.getByLabelText("消息正文");
  fireEvent.change(input, { target: { value: "中文答案" } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  expect(send).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  expect(send).toHaveBeenCalledTimes(1);
});
it("keeps drafts isolated between projects and across failures", async () => {
  const send = vi.fn().mockRejectedValue(new Error("offline"));
  const { rerender } = render(
    <Composer
      key="p"
      projectId="p"
      busy={false}
      answer={false}
      onSend={send}
    />,
  );
  fireEvent.change(screen.getByLabelText("消息正文"), {
    target: { value: "保留这段" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("发送未完成，草稿已保留。");
  expect((screen.getByLabelText("消息正文") as HTMLTextAreaElement).value).toBe(
    "保留这段",
  );
  rerender(
    <Composer
      key="q"
      projectId="q"
      busy={false}
      answer={false}
      onSend={send}
    />,
  );
  expect((screen.getByLabelText("消息正文") as HTMLTextAreaElement).value).toBe(
    "",
  );
  rerender(
    <Composer
      key="p"
      projectId="p"
      busy={false}
      answer={false}
      onSend={send}
    />,
  );
  expect((screen.getByLabelText("消息正文") as HTMLTextAreaElement).value).toBe(
    "保留这段",
  );
});

it("does not clear newly typed words when the prior send resolves", async () => {
  let resolve!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  render(<Composer projectId="p" busy={false} answer={false} onSend={send} />);
  const input = screen.getByLabelText("消息正文");
  fireEvent.change(input, { target: { value: "上一条" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  fireEvent.change(input, { target: { value: "下一段草稿" } });
  resolve();
  await new Promise((r) => setTimeout(r, 0));
  expect((input as HTMLTextAreaElement).value).toBe("下一段草稿");
  expect(localStorage.getItem("learning:draft:p")).toBe("下一段草稿");
});
