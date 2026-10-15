import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicEvent } from "@learning/contracts";
import { api } from "../../lib/api";
export function deduplicateEvents(events: PublicEvent[]) {
  return [
    ...new Map(events.map((e) => [`${e.project_id}:${e.seq}`, e])).values(),
  ].sort((a, b) => a.seq - b.seq);
}
export function useProjectEvents(
  projectId: string,
  latestSeq: number,
  active: boolean,
) {
  const client = useQueryClient(),
    [events, setEvents] = useState<PublicEvent[]>([]),
    [status, setStatus] = useState("connected"),
    refresh = useRef(() => {});
  useEffect(() => {
    let alive = true,
      busy = false,
      cursor = 0,
      timer: ReturnType<typeof setTimeout>;
    setEvents([]);
    async function pull() {
      if (!alive || busy || document.hidden) return;
      busy = true;
      try {
        let rounds = 0;
        do {
          const page = await api.getEvents(projectId, cursor);
          if (!alive) return;
          cursor = page.next_seq;
          setEvents((old) => deduplicateEvents([...old, ...page.events]));
          if (page.events.length)
            void client.invalidateQueries({
              queryKey: ["workspace", projectId],
            });
          if (!page.has_more) break;
        } while (++rounds < 25);
        setStatus("connected");
      } catch {
        if (alive) setStatus("offline");
      } finally {
        busy = false;
        if (alive) timer = setTimeout(pull, active ? 2000 : 15000);
      }
    }
    function visible() {
      clearTimeout(timer);
      if (!document.hidden) {
        void client.invalidateQueries({ queryKey: ["workspace", projectId] });
        void pull();
      }
    }
    refresh.current = visible;
    document.addEventListener("visibilitychange", visible);
    void pull();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [projectId, client, active]);
  useEffect(() => {
    if (latestSeq > 0) refresh.current();
  }, [latestSeq]);
  return { events, status, refresh: () => refresh.current() };
}
