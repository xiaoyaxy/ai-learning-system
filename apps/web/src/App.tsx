import { SubmissionCard } from "./features/archive/SubmissionCard";
import { artifactNames } from "./lib/labels";
import { Dialog } from "./components/Dialog";
import { ArtifactView } from "./features/archive/ArtifactView";
import { ArchivePanel } from "./features/archive/ArchivePanel";
import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProjectCommand,
  Role,
  WorkspaceDTO,
  PublicArtifactDTO,
} from "@learning/contracts";
import { api, pendingEnvelope, clearPending, RequestError } from "./lib/api";
import { Composer } from "./features/chat/Composer";
import { useProjectEvents } from "./features/chat/useProjectEvents";
export const roles: Record<
  Role,
  { name: string; short: string; description: string }
> = {
  supervisor: {
    name: "学务总管",
    short: "总",
    description: "协调派活 · 汇总与请示",
  },
  planner: { name: "规划师", short: "规", description: "定题诊断 · 学习安排" },
  curator: {
    name: "知识管家",
    short: "知",
    description: "资料地图 · 笔记与复习",
  },
  coach: { name: "陪练官", short: "练", description: "先答后评 · 迁移与审稿" },
};
const phases: Record<string, string> = {
  scoping: "明确学习目标",
  diagnosis: "了解你的起点",
  preparing: "准备资料与计划",
  learning: "学习进行中",
  practicing: "独立练习",
  reviewing: "每周复盘",
  completion_check: "完成检验",
  completed: "完成标准已达成",
};
const completionNames: Record<string, string> = {
  policy_required: "请先确认检验政策",
  in_progress: "还有题目未答完",
  pending_review: "存在待复核判断",
  not_met: "尚未达到完成标准",
  met: "已达到完成标准",
  stale: "目标已改变，旧证据过期",
};

export function App() {
  const projects = useQuery({
      queryKey: ["projects"],
      queryFn: api.listProjects,
    }),
    [selected, setSelected] = useState(
      () => localStorage.getItem("learning:selected") ?? "",
    ),
    [create, setCreate] = useState(false);
  useEffect(() => {
    if (projects.data?.length && !selected) setSelected(projects.data[0].id);
  }, [projects.data, selected]);
  function select(id: string) {
    setSelected(id);
    localStorage.setItem("learning:selected", id);
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="知行首页">
          <span>知</span>
          <div>
            <strong>知行</strong>
            <small>LEARNING CIRCLE</small>
          </div>
        </a>
        <div className="sidebar-heading">
          <span>我的学习群</span>
          <button aria-label="新建学习群" onClick={() => setCreate(true)}>
            ＋
          </button>
        </div>
        <nav aria-label="学习群" className="project-list">
          {projects.data?.map((p) => (
            <button
              key={p.id}
              className={selected === p.id ? "project selected" : "project"}
              onClick={() => select(p.id)}
            >
              <span className="project-icon">{p.name.slice(0, 1)}</span>
              <span>
                <strong>{p.name}</strong>
                <small>{phases[p.phase] ?? p.phase}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="mobile-projects">
          <label>
            学习群{" "}
            <select
              aria-label="切换学习群"
              value={selected}
              onChange={(e) => select(e.target.value)}
            >
              <option value="">选择学习群</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="mobile-add"
          aria-label="新建学习群"
          onClick={() => setCreate(true)}
        >
          ＋
        </button>
        <button className="new-project" onClick={() => setCreate(true)}>
          ＋ 新建学习群
        </button>
        <div className="sidebar-note">
          <strong>一群 AI，一个学习项目</strong>
          <p>
            把目标交给总管。一起查资料、练表达、补缺口，留下属于你的学习证据。
          </p>
        </div>
        <div className="account">
          <span className="avatar user">我</span>
          <div>
            <strong>我的学习空间</strong>
            <small>个人使用 · 项目独立保存</small>
          </div>
        </div>
      </aside>
      {projects.error && !projects.data ? (
        <div className="empty">
          <h1>暂时无法打开学习空间</h1>
          <p role="alert">{projects.error.message}</p>
          <button onClick={() => void projects.refetch()}>重新连接</button>
        </div>
      ) : projects.isPending ? (
        <div className="empty" role="status">
          正在读取学习群…
        </div>
      ) : selected ? (
        <Workspace key={selected} projectId={selected} />
      ) : (
        <div className="empty">
          <span className="eyebrow">LEARN · PRACTICE · REFLECT</span>
          <h1>把想学的，变成真正会的。</h1>
          <p>告诉总管一个目标，让四位学习伙伴陪你完成从理解到表达的过程。</p>
          <button className="primary" onClick={() => setCreate(true)}>
            创建第一个学习群
          </button>
        </div>
      )}
      {create && (
        <CreateDialog
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            select(id);
            setCreate(false);
            void projects.refetch();
          }}
        />
      )}
    </div>
  );
}
function Workspace({ projectId }: { projectId: string }) {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.getSession(),
  });
  const client = useQueryClient(),
    workspace = useQuery({
      queryKey: ["workspace", projectId],
      queryFn: () => api.getWorkspace(projectId),
      refetchInterval: (q) =>
        ["queued", "running"].includes(q.state.data?.active_run?.status ?? "")
          ? 2000
          : 15000,
    }),
    w = workspace.data,
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [details, setDetails] = useState(false),
    [artifact, setArtifact] = useState<PublicArtifactDTO | null>(null),
    [archives, setArchives] = useState(false),
    [requirements, setRequirements] = useState(false),
    [editPolicy, setEditPolicy] = useState(false),
    lock = useRef(false),
    active = ["queued", "running"].includes(w?.active_run?.status ?? ""),
    { events, status } = useProjectEvents(
      projectId,
      w?.latest_seq ?? 0,
      active,
    );
  async function send(command: ProjectCommand) {
    if (!w || lock.current) throw new Error("busy");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api.sendCommand(
        projectId,
        pendingEnvelope(projectId, w.revision, command),
      );
      clearPending(projectId);
      await workspace.refetch();
      void client.invalidateQueries({ queryKey: ["projects"] });
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500) {
        clearPending(projectId);
        if (e.code === "REVISION_CONFLICT") await workspace.refetch();
      }
      setError(e instanceof Error ? e.message : "保存未完成");
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!w)
    return (
      <div className="empty">
        <p role={workspace.error ? "alert" : "status"}>
          {workspace.error?.message ?? "正在读取项目记录…"}
        </p>
        {workspace.error && (
          <button onClick={() => void workspace.refetch()}>重新连接</button>
        )}
      </div>
    );
  const context = <Context w={w} events={events} onArtifact={setArtifact} />;
  const run = w.active_run;
  return (
    <>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">学习群 / 4 位 AI 伙伴</span>
            <h1>{w.project.name}</h1>
            <p>
              {w.project.time_constraint_text || "时间安排待明确"}{" "}
              <span>·</span> {w.project.timezone}
            </p>
          </div>
          <div className="header-actions">
            <button onClick={() => setDetails(true)}>群资料</button>
            <button onClick={() => setArchives(true)}>项目档案</button>
            <button onClick={() => setRequirements(true)}>补充要求</button>
            {run && active && (
              <button
                onClick={() =>
                  void send({ type: "pause_run", run_id: run.id }).catch(
                    () => {},
                  )
                }
              >
                暂停
              </button>
            )}
            {run?.status === "paused" && (
              <button
                onClick={() =>
                  void send({ type: "resume_run", run_id: run.id }).catch(
                    () => {},
                  )
                }
              >
                继续
              </button>
            )}
            {run?.status === "failed" && (
              <button
                onClick={() =>
                  void send({ type: "retry_run", run_id: run.id }).catch(
                    () => {},
                  )
                }
              >
                重试步骤
              </button>
            )}
            {run && ["paused", "failed"].includes(run.status) && (
              <button
                onClick={() =>
                  void send({ type: "cancel_run", run_id: run.id }).catch(
                    () => {},
                  )
                }
              >
                取消任务
              </button>
            )}
          </div>
        </header>
        {session.data?.mode === "demo" && (
          <div className="demo-banner">
            本地演示 · 模型和搜索使用测试数据，记录保存在本地
          </div>
        )}
        <div className="stage">
          <span className="status-dot" />
          <strong>{phases[w.phase]}</strong>
          <span>
            {active
              ? "学习伙伴正在协作"
              : w.pending_input?.kind === "answer"
                ? "下一步 · 你独立回答"
                : run?.status === "waiting_decision"
                  ? "下一步 · 你确认安排"
                  : "下一步 · 继续交流"}
          </span>
          <span className="connection">
            {status === "offline" ? "连接中断 · 草稿保留" : "已连接"}
          </span>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
            {error.includes("配置") && (
              <p>请按仓库中的部署手册设置模型、搜索和登录信息。</p>
            )}
          </div>
        )}
        {run?.error_code && (
          <div className="notice" role="alert">
            当前步骤未完成：{run.error_code}。已有记录保留。
            {run.error_code === "OUTCOME_UNKNOWN" &&
              " 重试可能再次产生模型用量。"}
          </div>
        )}
        <div className="conversation" aria-label="学习群消息">
          <p className="conversation-caption">每一次理解，都留下真实记录</p>
          {w.messages.length === 0 && (
            <div className="welcome-card">
              <h2>你的学习团队已就位</h2>
              <p>先发一段话，说说你想掌握什么、现在知道多少、有哪些困惑。</p>
            </div>
          )}
          {w.messages.map((m) => (
            <article className={`message ${m.role}`} key={m.id}>
              <span className={`avatar ${m.role}`}>
                {m.role === "user"
                  ? "我"
                  : m.role === "system"
                    ? "记"
                    : roles[m.role].short}
              </span>
              <div>
                <div className="message-meta">
                  <strong>
                    {m.role === "user"
                      ? "我"
                      : m.role === "system"
                        ? "系统记录"
                        : roles[m.role].name}
                  </strong>
                  <time>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: w.project.timezone,
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(m.created_at))}
                  </time>
                </div>
                <div className="message-body">
                  <MessageContent text={m.text} commandType={m.command_type} />
                </div>
              </div>
            </article>
          ))}
          {events
            .filter(
              (e) =>
                e.type === "handoff_committed" || e.type === "task_assigned",
            )
            .slice(-6)
            .map((e) => (
              <div className="handoff" key={e.seq}>
                <strong>
                  {e.payload.from ? roles[e.payload.from].name : "学务总管"} →{" "}
                  {e.payload.to ? roles[e.payload.to].name : "协作"}
                </strong>
                <span>{e.payload.text}</span>
              </div>
            ))}
          {w.policy?.status === "draft" && (
            <div className="card policy">
              <span className="eyebrow">
                完成检验政策 · v{w.policy.version}
              </span>
              <h2>由你确认，才作为完成依据</h2>
              <PolicySummary json={w.policy.summary} />
              <button
                disabled={busy || active}
                onClick={() => setEditPolicy(true)}
              >
                修改这份检验政策
              </button>
              <button
                className="primary"
                disabled={busy || active}
                onClick={() =>
                  void send({
                    type: "confirm_assessment_policy",
                    policy_id: w.policy!.id,
                    policy_version: w.policy!.version,
                  }).catch(() => {})
                }
              >
                确认这份检验政策
              </button>
            </div>
          )}
          {w.proposal && (
            <div className="card decision">
              <span className="eyebrow">
                目标影响请示 · v{w.proposal.version}
              </span>
              <h2>
                {w.proposal.impact === "unknown"
                  ? "目前无法确认目标不受影响"
                  : "调整可能影响原定目标"}
              </h2>
              <p className="preserve">{w.proposal.summary}</p>
              <div className="button-row">
                {(["accept", "retain", "pause"] as const).map((d, i) => (
                  <button
                    key={d}
                    disabled={busy || active}
                    className={i === 0 ? "primary" : ""}
                    onClick={() =>
                      void send({
                        type: "decide_proposal",
                        proposal_id: w.proposal!.id,
                        proposal_version: w.proposal!.version,
                        decision: d,
                      }).catch(() => {})
                    }
                  >
                    {["接受展示的变更", "保留原目标重排", "暂缓决定"][i]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {w.weekly_review && (
            <div className="card weekly-question">
              <span className="eyebrow">
                每周复盘 · {w.weekly_review.index} / {w.weekly_review.total}
              </span>
              <h2>{w.weekly_review.prompt}</h2>
              <p>用自己的话回答，我会逐次保存你的原话。</p>
            </div>
          )}
          {w.question && (
            <div
              className="card question"
              data-question-id={w.question.id}
              data-attempt-index={w.question.attempt_index}
            >
              <span className="eyebrow">
                独立回答 ·{" "}
                {w.question.attempt_index === 2 ? "一次追问" : "第一答"}
              </span>
              <h2>{w.question.prompt}</h2>
              <p>先合上资料，用自己的话回答。答案保存后再看反馈。</p>
            </div>
          )}
          {w.completion.status !== "policy_required" && (
            <div className="card completion">
              <strong>{completionNames[w.completion.status]}</strong>
              {w.completion.correct_count !== null && (
                <p>
                  正确 {w.completion.correct_count} / 完整题数{" "}
                  {w.completion.total_count} · 完成门槛 80%
                </p>
              )}
              <details>
                <summary>查看逐题成绩证据</summary>
                {w.completion.items.map((i) => (
                  <p key={i.question_id}>
                    {i.question_id.slice(0, 8)} · {i.verdict ?? "尚未判定"} ·
                    答题记录 {i.attempt_id?.slice(0, 8) ?? "暂无"}
                  </p>
                ))}
              </details>
            </div>
          )}
          {active && (
            <p role="status" className="processing">
              学习伙伴正在保存和整理当前步骤…
            </p>
          )}
        </div>
        <footer className="chat-footer">
          <div className="quick-actions">
            <button
              disabled={busy || active || !!w.pending_input}
              onClick={() =>
                void send({ type: "start_learning" }).catch(() => {})
              }
            >
              开始学习
            </button>
            <button
              disabled={busy || active || !!w.pending_input}
              onClick={() =>
                void send({ type: "start_practice" }).catch(() => {})
              }
            >
              独立练习
            </button>
            <button
              disabled={busy || active || !!w.pending_input}
              onClick={() =>
                void send({ type: "start_completion_check" }).catch(() => {})
              }
            >
              完成检验
            </button>
            <button
              disabled={busy || active || !!w.pending_input}
              onClick={() =>
                void send({ type: "start_weekly_review" }).catch(() => {})
              }
            >
              每周复盘
            </button>
            <label className="stage-jump">
              阶段{" "}
              <select
                aria-label="跳转阶段"
                value=""
                onChange={(e) => {
                  if (e.target.value)
                    void send({
                      type: "request_stage_jump",
                      phase: e.target.value as "learning",
                    }).catch(() => {});
                }}
              >
                <option value="">主动跳转…</option>
                <option value="scoping">重新明确目标</option>
                <option value="learning">回到学习</option>
              </select>
            </label>
          </div>
          <Composer
            key={projectId}
            projectId={projectId}
            answer={!!w.question || !!w.weekly_review}
            busy={busy || active}
            onSend={async (c) => {
              if (
                c.type === "send_message" &&
                c.mode === "answer" &&
                w.question
              ) {
                if (
                  c.target_role &&
                  !["coach", "supervisor"].includes(c.target_role)
                )
                  throw new Error("请选择陪练官回答");
                await send({
                  type: "submit_answer",
                  question_id: w.question.id,
                  question_version: w.question.version,
                  attempt_index: w.question.attempt_index,
                  text: c.text,
                });
              } else await send(c);
            }}
          />
        </footer>
      </main>
      <aside className="context-panel">{context}</aside>
      {requirements && (
        <SubmissionCard
          kind="requirements"
          busy={busy}
          onSend={send}
          onClose={() => setRequirements(false)}
        />
      )}
      {editPolicy && w.policy && (
        <SubmissionCard
          kind="policy"
          busy={busy || active}
          policy={w.policy}
          onSend={send}
          onClose={() => setEditPolicy(false)}
        />
      )}
      {archives && (
        <Dialog title="项目档案" onClose={() => setArchives(false)}>
          <ArchivePanel
            workspace={w}
            busy={busy || active}
            onSend={send}
            onView={setArtifact}
          />
        </Dialog>
      )}
      {w.assessments
        ?.filter((q) => q.goal_version === w.project.goal_version)
        .flatMap((q) => q.attempts)
        .filter((a) => a.evaluations.at(-1)?.verdict === "needs_review")
        .map((a) => (
          <div className="review-notice" key={a.id}>
            <span>这条答案正在等待复核，原文与历史评价会保留。</span>
            <button
              disabled={busy || active}
              onClick={() =>
                void send({ type: "reassess_answer", attempt_id: a.id }).catch(
                  () => {},
                )
              }
            >
              重新复核原答案
            </button>
          </div>
        ))}
      {details && (
        <Dialog title="群资料" onClose={() => setDetails(false)}>
          {context}
        </Dialog>
      )}
      {artifact && (
        <Dialog
          title={`${artifactNames[artifact.kind] ?? artifact.kind} · v${artifact.version}`}
          onClose={() => setArtifact(null)}
        >
          <ArtifactView artifact={artifact} workspace={w} />
        </Dialog>
      )}
    </>
  );
}
function PolicySummary({ json }: { json: string }) {
  let p: any;
  try {
    p = JSON.parse(json);
  } catch {
    return <p>{json}</p>;
  }
  return (
    <>
      <dl>
        <dt>完整题数</dt>
        <dd>{p.question_count} 题 / 轮</dd>
        <dt>技能覆盖</dt>
        <dd>{p.required_skill_ids?.join("、")}</dd>
        <dt>计分口径</dt>
        <dd>{p.attempt_basis === "first" ? "第一答" : "纠正后最后一答"}</dd>
        <dt>部分正确</dt>
        <dd>
          {p.partial_rule === "count_correct" ? "计为正确" : "不计为正确"}
        </dd>
        <dt>完成标准</dt>
        <dd>完整检验正确数 / 完整题数 ≥ 80%</dd>
        <dt>聚合</dt>
        <dd>
          {p.aggregation === "single_session"
            ? "单轮检验"
            : `指定 ${p.session_selection?.length} 轮检验`}
        </dd>
        <dt>不确定判断</dt>
        <dd>等待复核，不强制计错</dd>
      </dl>
      <details>
        <summary>查看完整版本与评分规则</summary>
        <pre>{json}</pre>
      </details>
    </>
  );
}
function Context({
  w,
  events,
  onArtifact,
}: {
  w: WorkspaceDTO;
  events: { type: string; payload: { to?: Role } }[];
  onArtifact: (a: PublicArtifactDTO) => void;
}) {
  const current = events.filter((e) => e.type === "task_assigned").at(-1)
      ?.payload.to,
    active = ["queued", "running"].includes(w.active_run?.status ?? ""),
    latest = w.artifacts.filter((a) => a.kind === "task_card").at(-1);
  let task: any;
  try {
    task = JSON.parse(latest?.content ?? "null");
  } catch {}
  return (
    <>
      <h2>你的学习团队</h2>
      <div className="team">
        {Object.entries(roles).map(([role, r]) => (
          <div className="team-member" key={role}>
            <span className={`avatar ${role}`}>{r.short}</span>
            <div>
              <strong>{r.name}</strong>
              <small>{r.description}</small>
            </div>
            <small>{active && current === role ? "处理中" : "待命"}</small>
          </div>
        ))}
      </div>
      <section>
        <h2>
          本轮学习目标 <span>v{w.project.goal_version}</span>
        </h2>
        <p className="preserve">{w.project.goal_text}</p>
        <small>时间约束：{w.project.time_constraint_text || "待明确"}</small>
        <h3>完成标准</h3>
        <p>完整检验正确率 ≥ 80%</p>
        <small>{completionNames[w.completion.status]}</small>
      </section>
      {task && (
        <section>
          <h2>
            今天的安排 <span>v{latest?.version}</span>
          </h2>
          <strong>{task.goal}</strong>
          {task.blocks?.map((b: any) => (
            <p key={b.kind}>
              <span className="task-kind">
                {
                  {
                    deep: "深入学习",
                    supplement: "补充巩固",
                    reflection: "回忆表达",
                  }[b.kind as "deep"]
                }
              </span>
              {b.activity}
            </p>
          ))}
        </section>
      )}
      <section>
        <h2>项目档案</h2>
        {Object.entries(artifactNames).map(([kind, name]) => {
          const items = w.artifacts.filter((a) => a.kind === kind),
            latest = items.at(-1);
          return (
            <button
              className="archive-link"
              key={kind}
              disabled={!latest || !!latest.tombstone}
              onClick={() => latest && onArtifact(latest)}
            >
              <span>{name}</span>
              <small>
                {latest
                  ? latest.tombstone
                    ? "已标记删除"
                    : `v${latest.version} ›`
                  : "尚未生成"}
              </small>
            </button>
          );
        })}
        <small>原始诊断与答案只追加保存</small>
      </section>
    </>
  );
}
function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState(""),
    [goal, setGoal] = useState(""),
    [time, setTime] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    op = useRef(crypto.randomUUID());
  return (
    <Dialog title="新建学习群" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const p = await api.createProject({
              client_operation_id: op.current,
              name,
              goal_text: goal,
              time_constraint_text: time,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            try {
              await api.sendCommand(
                p.id,
                pendingEnvelope(p.id, p.revision, {
                  type: "send_message",
                  mode: "message",
                  text: goal,
                }),
              );
              clearPending(p.id);
            } catch {
              // Preserve the initial operation for an explicit retry in the created group.
            } finally {
              onCreated(p.id);
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : "创建未完成");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          学习群名称
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：AI Agent 架构入门"
          />
        </label>
        <label>
          你想掌握什么
          <textarea
            required
            maxLength={12000}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="期望能做到什么？为什么想学？"
          />
        </label>
        <label>
          时间约束
          <input
            maxLength={12000}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="保留你的原话，例如两周内或 2026-10-28"
          />
        </label>
        <p>安排不会替你假定每天学习时长，后续再一起明确。</p>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "创建中…" : "创建学习群"}
        </button>
      </form>
    </Dialog>
  );
}

function MessageContent({
  text,
  commandType,
}: {
  text: string;
  commandType?: string;
}) {
  const actions: Record<string, string> = {
    start_learning: "开始今天的学习",
    start_practice: "开始独立练习",
    start_completion_check: "开始完成检验",
    start_weekly_review: "开始每周复盘",
    confirm_assessment_policy: "确认检验政策",
    decide_proposal: "确认计划决定",
    pause_run: "暂停协作",
    resume_run: "继续协作",
    retry_run: "重试当前步骤",
    cancel_run: "取消任务",
    delete_note: "标记删除笔记",
    reassess_answer: "复核已保存的答案",
    request_stage_jump: "按自己的选择跳转学习阶段",
  };
  if (commandType && actions[commandType])
    return <span className="user-action">{actions[commandType]}</span>;
  try {
    const value = JSON.parse(text);
    if (typeof value.goal === "string" && Array.isArray(value.blocks))
      return (
        <div className="inline-task">
          <strong>今日学习安排</strong>
          <p>{value.goal}</p>
          {value.blocks.map((b: any, i: number) => (
            <p key={i}>
              <strong>
                {{
                  deep: "深入学习",
                  supplement: "补充巩固",
                  reflection: "回忆表达",
                }[b.kind as "deep"] ?? "学习环节"}
              </strong>{" "}
              · {b.activity}
            </p>
          ))}
          <p>你的产出：{value.output}</p>
        </div>
      );
  } catch {}
  return <>{text}</>;
}
