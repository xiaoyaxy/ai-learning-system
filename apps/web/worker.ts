export default {
  async fetch(request: Request, env: { ASSETS: Fetcher; API: Fetcher }) {
    if (new URL(request.url).pathname.startsWith("/api/"))
      return env.API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
