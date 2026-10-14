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
    if (this.env.DEPLOYMENT_ENV === "local" && this.env.DEMO_MODE === "true")
      return [
        {
          title: "Cloudflare Agents（本地演示来源）",
          url: "https://developers.cloudflare.com/agents/",
          snippet: "本地演示用的资料链接，内容未实时抓取，请自行核对。",
        },
      ];
    throw new ApiError("CONFIGURATION_REQUIRED", 503);
  }
}
