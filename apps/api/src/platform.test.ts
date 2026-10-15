import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  SELF,
  runDurableObjectAlarm,
  evictDurableObject,
} from "cloudflare:test";
import type { TestParent } from "../test-worker";
import webWorker from "../../web/worker";
const bindings = env as unknown as {
  TEST_PARENT: DurableObjectNamespace<TestParent>;
};
describe("deployment boundaries", () => {
  it("serves the registered health API", async () => {
    const response = await SELF.fetch("https://local.test/api/v1/health");
    expect(response.status).toBe(200);
  });
  it("forwards the web API path through a real service binding", async () => {
    const response = await webWorker.fetch(
      new Request("https://local.test/api/v1/health"),
      { API: SELF, ASSETS: SELF },
    );
    expect(response.status).toBe(200);
  });
  it("executes an isolated expert through SDK RPC", async () => {
    const parent = bindings.TEST_PARENT.get(
      bindings.TEST_PARENT.idFromName("rpc"),
    );
    expect(await parent.delegate("项目一")).toBe("项目一");
  });
  it("runs a scheduled callback after the instance is evicted", async () => {
    const parent = bindings.TEST_PARENT.get(
      bindings.TEST_PARENT.idFromName("checkpoint"),
    );
    await parent.queueCheckpoint();
    await evictDurableObject(parent);
    await runDurableObjectAlarm(parent);
    expect(await parent.readCheckpoint()).toEqual({ checkpoint: "persisted" });
  });
});
