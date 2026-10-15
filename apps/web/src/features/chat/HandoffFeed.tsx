import React from "react";
import type { PublicEvent, Role, PublicMessage } from "@learning/contracts";
export function HandoffFeed({
  events,
  runId,
  roles,
}: {
  events: PublicEvent[];
  runId: string | null;
  roles: Record<Role, { name: string }>;
}) {
  const hints = handoffHints(events, runId);
  if (!hints.length) return null;
  return (
    <section aria-label="本轮协作">
      {hints.slice(-6).map((e) => (
        <div className="handoff" key={e.seq}>
          <strong>
            {roles[e.payload.from ?? "supervisor"].name} →{" "}
            {e.payload.to ? roles[e.payload.to].name : "协作"}
          </strong>
          <span>{e.payload.text}</span>
        </div>
      ))}
    </section>
  );
}

function handoffHints(
  events: PublicEvent[],
  runId: string | null,
): PublicEvent[] {
  if (!runId) return [];
  const hints: PublicEvent[] = [];
  for (const event of events) {
    if (
      event.run_id !== runId ||
      !["handoff_committed", "task_assigned"].includes(event.type)
    )
      continue;
    const previous = hints.at(-1);
    if (
      previous &&
      (previous.payload.from ?? "supervisor") ===
        (event.payload.from ?? "supervisor") &&
      previous.payload.to === event.payload.to &&
      previous.payload.text === event.payload.text
    )
      hints[hints.length - 1] = event;
    else hints.push(event);
  }
  return hints.slice(-6);
}
export function placeHandoffs(
  events: PublicEvent[],
  messages: PublicMessage[],
  runId: string | null,
) {
  const before: Record<string, PublicEvent[]> = {},
    after: PublicEvent[] = [];
  for (const event of handoffHints(events, runId)) {
    const reply = messages.find((m) => {
      if (
        m.role !== event.payload.to ||
        (m.run_id !== undefined && m.run_id !== runId)
      )
        return false;
      const marker = events.find(
        (e) =>
          e.run_id === runId &&
          e.role === m.role &&
          e.type === "message_committed" &&
          (e.payload.entity_id === m.id || e.payload.text === m.text),
      );
      return marker
        ? marker.seq > event.seq
        : Date.parse(m.created_at) >= Date.parse(event.occurred_at);
    });
    if (reply) (before[reply.id] ??= []).push(event);
    else after.push(event);
  }
  return { before, after };
}
