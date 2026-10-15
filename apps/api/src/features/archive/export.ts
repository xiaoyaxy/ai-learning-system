import type { WorkspaceRecord } from "../../db/types";
import type { PublicArtifactDTO } from "@learning/contracts";
import { toWorkspaceDTO } from "../../http/projector";
function literal(text: string) {
  const longest = Math.max(
      2,
      ...(text.match(/`+/g) ?? []).map((s) => s.length),
    ),
    fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}\n`;
}
const names: Record<string, string> = {
  definition: "项目定义.md",
  diagnosis: "起点诊断.md",
  plan: "学习计划.md",
  task_card: "今日任务卡.md",
  knowledge_map: "资料与知识地图.md",
  learning_card: "学习卡.md",
  note: "笔记.md",
  draft: "交付物初稿.md",
  final: "交付物终稿.md",
  review_comments: "审稿与查证清单.md",
  weekly_report: "周报.md",
  index: "index.md",
};
export function exportProject(
  record: WorkspaceRecord,
  artifacts: PublicArtifactDTO[],
) {
  const dto = toWorkspaceDTO(record),
    sections = [
      "# 学习项目档案",
      literal(
        `${record.project.name}\n目标：${record.project.goal_text}\n时间约束：${record.project.time_constraint_text}\n目标版本：${record.project.goal_version}`,
      ),
    ];
  for (const a of artifacts)
    sections.push(
      `## ${names[a.kind] ?? "学习记录.md"} · v${a.version}${a.tombstone ? " · 删除标记" : ""}`,
      literal(a.content),
    );
  sections.push(
    "## 答题记录.md",
    literal(JSON.stringify(dto.assessments ?? [], null, 2)),
    "## 群聊原始记录.md",
    ...dto.messages.map((m) =>
      literal(`${m.role} · ${m.created_at} · ${m.id}\n${m.text}`),
    ),
    "## 完成检验证据.md",
    literal(JSON.stringify(dto.completion, null, 2)),
  );
  return sections.join("\n\n");
}
