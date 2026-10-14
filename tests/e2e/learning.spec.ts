import { test, expect, type Page } from "@playwright/test";
async function create(page: Page, name: string) {
  await page
    .getByRole("button", { name: "新建学习群", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("学习群名称").fill(name);
  await dialog
    .getByLabel("你想掌握什么")
    .fill("两周内理解 AI Agent 与工具的区别，并独立解释");
  await dialog.getByLabel("时间约束").fill("2026-10-28");
  await dialog.getByRole("button", { name: "创建学习群", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.locator(".message.supervisor").getByText(/是否开始学习/),
  ).toBeVisible({ timeout: 30000 });
}
async function prepare(page: Page) {
  await page.getByLabel("消息正文").fill("开始");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.locator(".stage").getByText("学习进行中", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "独立练习", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
}
test("项目群聊：两个项目隔离、独立答题、政策确认和成绩证据", async ({
  page,
}) => {
  await page.goto("/");
  const name = `Agent ${Date.now()}`;
  await create(page, name);
  await prepare(page);
  await page.getByRole("button", { name: "独立练习", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Agent 与工具有什么区别？请用自己的话解释。",
    }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByLabel("消息正文").fill("工具就是 Agent");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "请重新用自己的话解释涉及的概念，并说明它们之间的区别。",
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("参考解释（演示）：Agent 围绕目标决策，工具负责具体操作。", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel("消息正文").fill("Agent 决策，工具执行具体操作");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText(/回答正确。/).last()).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Agent 与工具有什么区别？请用自己的话解释。",
    }),
  ).toBeVisible({ timeout: 30000 });
  await create(page, `Second ${Date.now()}`);
  await expect(page.getByText("工具就是 Agent", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("navigation", { name: "学习群" })
    .getByRole("button")
    .filter({ hasText: name })
    .click();
  await expect(page.getByText("工具就是 Agent", { exact: true })).toBeVisible();
  await page.getByLabel("跳转阶段").selectOption("learning");
  await expect(
    page.getByRole("button", { name: "完成检验", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "完成检验", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认这份检验政策" }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "确认这份检验政策" }).click();
  await expect(
    page.getByRole("button", { name: "完成检验", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "完成检验", exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await expect(
      page.getByRole("heading", {
        name: /Agent 与工具有什么区别|如何把 Agent/,
      }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel("消息正文")).toBeEnabled();
    await page.getByLabel("消息正文").fill("Agent 决策，工具执行");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText("学习伙伴正在保存和整理当前步骤…")).toHaveCount(
      0,
      { timeout: 30000 },
    );
  }
  await expect(
    page.getByText("已达到完成标准", { exact: true }).first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("正确 5 / 完整题数 5 · 完成门槛 80%", { exact: true }),
  ).toBeVisible();
});
test("项目群聊：窄屏布局、对话框焦点与 Escape", async ({ page }) => {
  const projects = await (await page.request.get("/api/v1/projects")).json();
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      json: [
        ...projects,
        ...Array.from({ length: 30 }, (_, i) => ({
          ...projects[0],
          id: "layout-" + i,
          name: "布局项目 " + i,
        })),
      ],
    }),
  );
  await page.goto("/");
  for (const width of [320, 375, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `test-results/workspace-${width}.png`,
      fullPage: true,
    });
  }
  await expect
    .poll(async () => {
      const box = await page.locator(".composer").boundingBox();
      return !!box && box.y + box.height <= 900;
    })
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator(".project")
        .first()
        .evaluate((button) => {
          const box = button.getBoundingClientRect(),
            title = button.querySelector("strong")!.getBoundingClientRect(),
            phase = button.querySelector("small")!.getBoundingClientRect();
          return title.top >= box.top && phase.bottom <= box.bottom;
        }),
    )
    .toBe(true);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("button", { name: "新建学习群", exact: true }).click();
  await expect(page.getByLabel("学习群名称")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("项目群聊：断网草稿保留和重新连接", async ({ page, context }) => {
  await page.goto("/");
  await create(page, `Offline ${Date.now()}`);
  await context.setOffline(true);
  await page.getByLabel("消息正文").fill("这段起点诊断应该保留");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("发送未完成，草稿已保留。")).toBeVisible();
  await expect(page.getByLabel("消息正文")).toHaveValue("这段起点诊断应该保留");
  await context.setOffline(false);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page
      .getByLabel("学习群消息")
      .getByText("这段起点诊断应该保留", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("消息正文")).toHaveValue("");
  await page.reload();
  await expect(
    page
      .getByLabel("学习群消息")
      .getByText("这段起点诊断应该保留", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
});

test("项目群聊：原生 Agent RPC 保留版本冲突错误", async ({ page, request }) => {
  await page.goto("/");
  await create(page, `Conflict ${Date.now()}`);
  const id = await page.evaluate(() =>
    localStorage.getItem("learning:selected"),
  );
  const response = await request.post(`/api/v1/projects/${id}/commands`, {
    headers: { Origin: "http://127.0.0.1:8787" },
    data: {
      client_operation_id: crypto.randomUUID(),
      expected_revision: 0,
      command: { type: "send_message", mode: "message", text: "过期请求" },
    },
  });
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ code: "REVISION_CONFLICT" });
});

test("项目群聊：暂停协作、刷新恢复和显式重试", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "新建学习群", exact: true })
    .first()
    .click();
  const d = page.getByRole("dialog");
  const name = `Pause ${Date.now()}`;
  await d.getByLabel("学习群名称").fill(name);
  await d.getByLabel("你想掌握什么").fill("理解 Agent");
  await d.getByRole("button", { name: "创建学习群", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const retry = page.getByRole("button", { name: "重试步骤", exact: true });
  const diagnosis = page
    .locator(".message.supervisor")
    .getByText(/是否开始学习/);
  await expect(diagnosis.or(retry).first()).toBeVisible({ timeout: 30000 });
  if (await retry.isVisible()) await retry.click();
  await expect(diagnosis).toBeVisible({ timeout: 30000 });
});
test("项目群聊：答题反馈交接、延期请示和保留原目标", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "新建学习群", exact: true })
    .first()
    .click();
  const d = page.getByRole("dialog");
  const name = `Decision ${Date.now()}`;
  await d.getByLabel("学习群名称").fill(name);
  await d.getByLabel("你想掌握什么").fill("理解 Agent，延期演示");
  await d.getByLabel("时间约束").fill("2026-10-28");
  await d.getByRole("button", { name: "创建学习群", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.locator(".message.supervisor").getByText(/是否开始学习/),
  ).toBeVisible({ timeout: 30000 });
  await prepare(page);
  await page.getByRole("button", { name: "独立练习", exact: true }).click();
  for (let i = 0; i < 8; i++) {
    await expect(
      page.locator(".question").getByRole("heading", {
        name: /Agent 与工具|如何把 Agent|请重新用自己的话/,
      }),
    ).toBeVisible({ timeout: 30000 });
    const question = page.locator(".question"),
      before =
        (await question.getAttribute("data-question-id")) +
        ":" +
        (await question.getAttribute("data-attempt-index"));
    await page.getByLabel("消息正文").fill(`不确定 ${i}`);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("学习伙伴正在保存和整理当前步骤…")).toHaveCount(
      0,
      { timeout: 30000 },
    );
    await expect
      .poll(
        async () =>
          (await question.count())
            ? (await question.getAttribute("data-question-id")) +
              ":" +
              (await question.getAttribute("data-attempt-index"))
            : "finished",
        { timeout: 30000 },
      )
      .not.toBe(before);
  }
  await expect(
    page.getByRole("heading", { name: "调整可能影响原定目标" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".workspace-header")).toContainText("2026-10-28");
  await page.getByRole("button", { name: "保留原目标重排" }).click();
  await expect(
    page.getByRole("heading", { name: "调整可能影响原定目标" }),
  ).toHaveCount(0);
  await expect(page.locator(".workspace-header")).toContainText("2026-10-28");
});

test("归档与成果：原稿、审稿、终稿、笔记版本和复盘导出", async ({ page }) => {
  await page.goto("/");
  await create(page, `Archive ${Date.now()}`);
  await prepare(page);
  const entry = page.getByRole("button", { name: "项目档案", exact: true });
  await expect(entry).toBeVisible({ timeout: 2000 });
  await entry.click();
  await page.getByRole("button", { name: "提交初稿", exact: true }).click();
  const draft = "我的草稿，标点和原话都保留。\n\nAgent 决策，工具执行。";
  await page.getByLabel("你的原稿").fill(draft);
  await page.getByRole("button", { name: "原样提交初稿" }).click();
  await expect(
    page.getByRole("button", { name: "审稿意见 · v1", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "第一版成果 · v1", exact: true })
    .click();
  const view = page.getByRole("dialog", { name: "第一版成果 · v1" });
  await expect(view).toContainText("我的草稿，标点和原话都保留。");
  await view.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByRole("button", { name: "提交终稿", exact: true }).click();
  await page.getByLabel("你的原稿").fill("我的终稿，由我自己决定表达。");
  await page.getByRole("button", { name: "原样提交终稿" }).click();
  await expect(
    page.getByRole("button", { name: "最终成果 · v1", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await page.getByLabel("笔记正文").fill("我的笔记，未由 AI 扩写。");
  await page.getByRole("button", { name: "保存这个新版本" }).click();
  await expect(
    page.getByRole("button", { name: "学习笔记 · v1", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("dialog", { name: "项目档案" })
    .getByRole("button", { name: "关闭对话框" })
    .click();
  await page.getByRole("button", { name: "每周复盘", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await expect(page.locator(".weekly-question")).toContainText(
      `${i + 1} / 4`,
    );
    await page.getByLabel("消息正文").fill(`复盘回答 ${i}`);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    if (i < 3)
      await expect(page.locator(".weekly-question")).toContainText(
        `${i + 2} / 4`,
      );
    else await expect(page.locator(".weekly-question")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "项目档案", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "每周复盘 · v1", exact: true }),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "下载 Markdown 档案" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/learning-.*\.md/);
});

test("归档与成果：学习卡引用、两次复习和笔记删除标记", async ({ page }) => {
  await page.goto("/");
  await create(page, `Cards ${Date.now()}`);
  await prepare(page);
  await page.getByRole("button", { name: "项目档案", exact: true }).click();
  await page.getByRole("button", { name: "记录学习卡", exact: true }).click();
  for (const [label, value] of [
    ["资料要解决的问题", "如何理解 Agent"],
    ["我读懂的第一个点", "Agent 负责决策"],
    ["我读懂的第二个点", "工具负责执行"],
    ["我读懂的第三个点", "反馈帮助修正路径"],
    ["最有帮助的例子", "学习助手先确定问题再调用搜索"],
    ["仍说不清的地方", "还不清楚长期记忆怎么实现"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "整理这张学习卡" }).click();
  await expect(
    page.getByRole("button", { name: "学习卡 · v1", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "记录这次复习", exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await page.getByLabel("笔记正文").fill("这是我的原笔记");
  await page.getByRole("button", { name: "保存这个新版本" }).click();
  await expect(
    page.getByRole("button", { name: "学习笔记 · v1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "标记删除笔记", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "学习笔记 · v2 · 删除标记", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "学习笔记 · v1", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "学习笔记 · v1" }),
  ).toContainText("这是我的原笔记");
});

test("项目群聊：修改政策草案与补充要求重新协调", async ({ page }) => {
  await page.goto("/");
  await create(page, `Policy ${Date.now()}`);
  await prepare(page);
  await page.getByRole("button", { name: "补充要求", exact: true }).click();
  await page
    .getByLabel("补充要求正文")
    .fill("保留目标与原期限，只重排材料顺序");
  await page.getByRole("button", { name: "原样保存并重新协调" }).click();
  await expect(page.getByLabel("学习群消息")).toContainText(
    "已保存补充要求并停止旧任务",
  );
  await expect(
    page.getByRole("button", { name: "完成检验", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "完成检验", exact: true }).click();
  await page.getByRole("button", { name: "修改这份检验政策" }).click();
  await page.getByLabel("政策修改要求").fill("改为六题，仍然按第一答计算");
  await page.getByRole("button", { name: "提出新政策草案" }).click();
  await expect(page.locator(".policy")).toContainText("v2", { timeout: 30000 });
  await expect(page.locator(".policy")).toContainText("6 题 / 轮");
  await page.getByRole("button", { name: "确认这份检验政策" }).click();
  await expect(
    page.getByRole("button", { name: "确认这份检验政策" }),
  ).toHaveCount(0);
});
test("整体计划等待确认、今日内容与资料链接、删除恢复和彻底清除", async ({
  page,
}) => {
  await page.goto("/");
  const name = `删除与资料验收 ${Date.now()}`;
  await create(page, name);
  await expect(page.locator(".resource-overview")).toContainText("份材料");
  await expect(
    page.getByRole("button", { name: "独立练习", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".inline-task")).toHaveCount(0);
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  const content = page.getByRole("dialog", { name: "学习内容与资料" });
  await expect(content).toBeVisible({ timeout: 30000 });
  await expect(content.getByRole("link").first()).toHaveAttribute(
    "href",
    /^https:/,
  );
  await expect(content).toContainText("学习内容");
  await content.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.locator(".workspace-header")).toContainText("Asia/Beijing");
  await page.getByRole("button", { name: "删除群", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除群", exact: true }).click();
  await page.getByRole("button", { name: "移到已删除", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "已删除学习群", exact: true }).click();
  const row = page.locator(".deleted-project").filter({ hasText: name });
  await row.getByRole("button", { name: "恢复学习群" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator(".resource-overview")).toContainText("份材料");
  await page.getByRole("button", { name: "删除群", exact: true }).click();
  await page.getByRole("button", { name: "彻底删除", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认彻底删除" }),
  ).toBeDisabled();
  await page.getByLabel("输入学习群名称确认").fill(name);
  await page.getByRole("button", { name: "确认彻底删除" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: `删除学习群 ${name}`, exact: true }),
  ).toHaveCount(0);
});
