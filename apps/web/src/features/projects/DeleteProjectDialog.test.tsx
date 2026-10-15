import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
afterEach(cleanup);
it("requires the project name for permanent deletion and cancellation never deletes", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {};
  const remove = vi.fn().mockResolvedValue(undefined),
    cancel = vi.fn(),
    u = userEvent.setup();
  render(
    <DeleteProjectDialog
      project={{ id: "p", name: "Agent学习" }}
      onClose={cancel}
      onDelete={remove}
    />,
  );
  await u.click(screen.getByRole("button", { name: "彻底删除" }));
  const confirm = screen.getByRole("button", { name: "确认彻底删除" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await u.type(screen.getByLabelText("输入学习群名称确认"), "Agent学习");
  await u.click(confirm);
  expect(remove).toHaveBeenCalledWith(true, "Agent学习");
});
it("moving to deleted is recoverable and cancel has no side effects", async () => {
  const remove = vi.fn(),
    cancel = vi.fn(),
    u = userEvent.setup();
  render(
    <DeleteProjectDialog
      project={{ id: "p", name: "Agent学习" }}
      onClose={cancel}
      onDelete={remove}
    />,
  );
  await u.click(screen.getByRole("button", { name: "取消" }));
  expect(cancel).toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  await u.click(screen.getByRole("button", { name: "移到已删除" }));
  expect(remove).toHaveBeenCalledWith(false, undefined);
});
