import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoLogin } from "./DemoLogin";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps a failed password visible as an error and opens the workspace after a successful retry", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "UNAUTHENTICATED", message: "密码不正确" }),
        { status: 401 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "authenticated" })),
    );
  vi.stubGlobal("fetch", fetch);
  const success = vi.fn();
  render(<DemoLogin onSuccess={success} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("访问密码"), "wrong");
  await user.click(screen.getByRole("button", { name: "进入学习群" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "密码不正确",
  );
  expect(success).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("访问密码"));
  await user.type(screen.getByLabelText("访问密码"), "correct");
  await user.click(screen.getByRole("button", { name: "进入学习群" }));
  expect(success).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[1][1]).toMatchObject({
    credentials: "same-origin",
    body: JSON.stringify({ password: "correct" }),
  });
});
