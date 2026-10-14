import { createApp } from "./http/routes";
import { ProjectRepository } from "./db/repository";
import type { Env } from "./env";
import { ProjectSupervisor } from "./agents/project-supervisor";
export { ProjectSupervisor };
export { PlannerAgent } from "./agents/planner";
export { CuratorAgent } from "./agents/curator";
export { CoachAgent } from "./agents/coach";
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const parent = async (
      principal: { owner_id: string },
      projectId: string,
    ) => {
      const namespace =
        env.PROJECT_SUPERVISOR as DurableObjectNamespace<ProjectSupervisor>;
      const stub = namespace.get(
        namespace.idFromName(`${principal.owner_id}:${projectId}`),
      );
      await stub.bindProject(principal, projectId);
      return stub;
    };
    return createApp({
      repo: new ProjectRepository(env.DB),
      dispatcher: {
        accept: async (principal, projectId, envelope) =>
          (await parent(principal, projectId)).accept(principal, envelope),
        wake: async (principal, projectId) => {
          await (await parent(principal, projectId)).reconcile();
        },
      },
    }).fetch(request, env, ctx);
  },
};
