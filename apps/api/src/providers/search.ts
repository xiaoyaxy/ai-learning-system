import type { Env } from "../env";
import { ApiError } from "../http/errors";
export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}
export interface SearchProvider {
  search(
    query: string,
    scope: { project_id: string; goal_version: number },
  ): Promise<SearchHit[]>;
}
export class ConfiguredSearchProvider implements SearchProvider {
  constructor(private env: Env) {}
  async search(
    _query: string,
    _scope: { project_id: string; goal_version: number },
  ): Promise<SearchHit[]> {
    throw new ApiError("CONFIGURATION_REQUIRED", 503);
  }
}
