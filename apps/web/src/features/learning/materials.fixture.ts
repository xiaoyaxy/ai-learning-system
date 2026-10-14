import type { WorkspaceDTO } from "@learning/contracts";
export const fixture = {
  project: { goal_version: 1, active_plan_id: "plan1" },
  phase: "learning",
  materials: [
    {
      id: "s1",
      reference_no: "M01",
      title: "Agent官方文档",
      url: "https://docs.example.com/agent",
      summary: "Agent由模型、工具与状态循环组成。",
      goal_version: 1,
    },
    {
      id: "old",
      reference_no: "M01",
      title: "旧目标材料",
      url: "https://docs.example.com/old",
      goal_version: 0,
    },
  ],
  artifacts: [
    {
      id: "map1",
      kind: "knowledge_map",
      version: 1,
      content: JSON.stringify({
        concepts: [
          {
            name: "工具调用",
            definition: "使用受约束的函数与外部系统交互。",
            citation_ids: ["s1"],
          },
        ],
        source_catalog: [
          {
            id: "s1",
            reference_no: "M01",
            title: "Agent官方文档",
            url: "https://docs.example.com/agent",
          },
        ],
      }),
    },
    {
      id: "plan1",
      kind: "plan",
      version: 1,
      content: JSON.stringify({
        tasks: [
          { goal: "构建工具调用", output: "可运行代码", material_ids: ["s1"] },
        ],
      }),
    },
    {
      id: "plan2",
      kind: "plan",
      version: 2,
      content: JSON.stringify({
        tasks: [{ goal: "未激活路线", material_ids: ["old"] }],
      }),
    },
  ],
} as unknown as WorkspaceDTO;
