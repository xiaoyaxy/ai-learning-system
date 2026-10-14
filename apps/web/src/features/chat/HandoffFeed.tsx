import React from "react";
import type { PublicEvent, Role } from "@learning/contracts";
export function HandoffFeed({
  events,
  runId,
  roles,
}: {
  events: PublicEvent[];
  runId: string | null;
  roles: Record<Role, { name: string }>;
}) {
  if (!runId) return null;
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
