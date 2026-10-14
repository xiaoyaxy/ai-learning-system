import { it, expect } from "vitest";
import { deduplicateEvents } from "./useProjectEvents";
import { pendingEnvelope } from "../../lib/api";
import type { PublicEvent } from "@learning/contracts";
it("deduplicates monotonic events without sharing project cursors", () => {
  const event = (p: string, seq: number) =>
    ({ project_id: p, seq }) as PublicEvent;
  expect(
    deduplicateEvents([event("a", 13), event("a", 12), event("a", 12)]).map(
      (e) => e.seq,
    ),
  ).toEqual([12, 13]);
  expect(deduplicateEvents([event("b", 12), event("a", 12)])).toHaveLength(2);
});
it("reuses the operation envelope after an uncertain network result", () => {
  localStorage.clear();
  const c = {
      type: "send_message" as const,
      text: "原文",
      mode: "message" as const,
    },
    a = pendingEnvelope("p", 3, c);
  expect(pendingEnvelope("p", 9, c)).toEqual(a);
  expect(pendingEnvelope("q", 9, c).client_operation_id).not.toBe(
    a.client_operation_id,
  );
});
