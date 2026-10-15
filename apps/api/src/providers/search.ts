import { z } from "zod";
import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { publicHttpsUrl } from "./source-reader";
import { providerJson, type ProviderOptions } from "./http";
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
const ResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string().nullable().optional(),
    }),
  ),
});
export class ConfiguredSearchProvider implements SearchProvider {
  constructor(
    private env: Env,
    private options: ProviderOptions = {},
  ) {}
  async search(
    query: string,
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
    if (this.env.SEARCH_PROVIDER !== "tavily" || !this.env.SEARCH_API_KEY)
      throw new ApiError("CONFIGURATION_REQUIRED", 503);
    if (query.length > 2000) throw new ApiError("INPUT_TOO_LARGE", 422);
    const { data } = await providerJson(
      "https://api.tavily.com/search",
      {
        query,
        search_depth: "basic",
        max_results: 2,
        include_answer: false,
        include_raw_content: false,
        auto_parameters: false,
      },
      this.env.SEARCH_API_KEY,
      this.options,
    );
    const result = ResponseSchema.safeParse(data);
    if (!result.success) throw new ApiError("MODEL_INVALID_RESULT", 422);
    return result.data.results
      .filter((r) => publicHttpsUrl(r.url))
      .slice(0, 2)
      .map((r) => ({
        title: r.title.slice(0, 500),
        url: r.url,
        snippet: (r.content ?? "").slice(0, 4000),
      }));
  }
}
