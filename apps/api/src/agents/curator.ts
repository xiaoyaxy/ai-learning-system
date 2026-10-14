import { Agent } from "agents";
import type { Env } from "../env";
import type { RoleTask } from "../runtime/types";
import { ConfiguredModelGateway } from "../providers/model";
import { ROLE_PROMPTS } from "./prompts";
import { ApiError } from "../http/errors";
export class CuratorAgent extends Agent<Env, { project_id: string | null }> {
  initialState = { project_id: null };
  async execute(task: RoleTask) {
    if (
      task.role !== "curator" ||
      (this.state.project_id && this.state.project_id !== task.project_id)
    )
      throw new ApiError("FORBIDDEN", 403);
    if (!this.state.project_id) this.setState({ project_id: task.project_id });
    return new ConfiguredModelGateway(this.env).generate({
      task,
      system: ROLE_PROMPTS.curator,
      schema_name: task.action,
    });
  }
}
