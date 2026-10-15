import type {
  ProjectCommand,
  CommandEnvelope,
  AcceptedCommand,
  WorkspaceDTO,
  EventPageDTO,
  CreateProjectInput,
} from "@learning/contracts";
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new RequestError(
      "NETWORK_ERROR",
      "网络未连接，已有内容保留，可以重试。",
      0,
    );
  }
  const value: any = await response.json().catch(() => null);
  if (!response.ok || !value)
    throw new RequestError(
      value?.code ?? "AUTHENTICATION_REQUIRED",
      value?.message ?? "请先登录或检查服务配置。",
      response.status,
    );
  return value as T;
}
export interface ProjectSummary {
  id: string;
  name: string;
  goal_text: string;
  phase: string;
  timezone: string;
}
export const api = {
  login: (password: string) =>
    request<{ status: string }>("/login", { password }),
  getSession: () =>
    request<{
      mode: string;
      environment: string;
      model?: string | null;
      search?: string;
    }>("/session"),
  listProjects: () => request<ProjectSummary[]>("/projects"),
  listDeletedProjects: () => request<ProjectSummary[]>("/projects/deleted"),
  deleteProject: (id: string, permanent: boolean, confirmation_name?: string) =>
    request<{ status: string }>(
      `/projects/${encodeURIComponent(id)}`,
      { permanent, confirmation_name },
      "DELETE",
    ),
  restoreProject: (id: string) =>
    request<{ status: string }>(
      `/projects/${encodeURIComponent(id)}/restore`,
      {},
    ),
  createProject: (p: CreateProjectInput) =>
    request<{ id: string; revision: number }>("/projects", p),
  getWorkspace: (id: string) =>
    request<WorkspaceDTO>(`/projects/${encodeURIComponent(id)}/workspace`),
  sendCommand: (id: string, envelope: CommandEnvelope) =>
    request<AcceptedCommand>(
      `/projects/${encodeURIComponent(id)}/commands`,
      envelope,
    ),
  getEvents: (id: string, seq: number) =>
    request<EventPageDTO>(
      `/projects/${encodeURIComponent(id)}/events?after_seq=${seq}`,
    ),
};
export function pendingEnvelope(
  projectId: string,
  revision: number,
  command: ProjectCommand,
): CommandEnvelope {
  const key = `learning:pending:${projectId}`,
    raw = localStorage.getItem(key);
  if (raw) {
    try {
      const prior = JSON.parse(raw) as CommandEnvelope;
      if (JSON.stringify(prior.command) === JSON.stringify(command))
        return prior;
    } catch {}
  }
  const envelope = {
    client_operation_id: crypto.randomUUID(),
    expected_revision: revision,
    command,
  };
  localStorage.setItem(key, JSON.stringify(envelope));
  return envelope;
}
export function clearPending(projectId: string) {
  localStorage.removeItem(`learning:pending:${projectId}`);
}
