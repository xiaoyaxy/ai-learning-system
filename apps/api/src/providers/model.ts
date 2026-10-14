import type { Env } from "../env";
import type { RoleTask, RoleResult } from "../runtime/types";
import { ApiError } from "../http/errors";
export interface RoleModelRequest {
  task: RoleTask;
  system: string;
  schema_name: string;
}
export interface RoleModelResult extends RoleResult {
  request_id?: string;
}
export interface ModelGateway {
  generate(request: RoleModelRequest): Promise<RoleModelResult>;
}
export class ConfiguredModelGateway implements ModelGateway {
  constructor(private env: Env) {}
  async generate(_request: RoleModelRequest): Promise<RoleModelResult> {
    throw new ApiError("CONFIGURATION_REQUIRED", 503);
  }
}
