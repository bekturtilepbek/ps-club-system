import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HallSnapshotResponse } from "@/lib/api";
import { updateClockOffset } from "@/lib/clock";

export const HALL_QUERY_KEY = ["hall"] as const;

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws/hall`;
}

export function useHallSnapshot() {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const retryCount = useRef(0);
  // The poll fetch and the websocket push both write to the same cache entry
  // with no ordering guarantee between them: a poll started before a fresher
  // snapshot arrives over the socket can still resolve afterwards and must
  // not be allowed to clobber it. Track when the last socket message landed
  // and, in the poll's queryFn, discard the fetch result if a socket message
  // arrived after the fetch was issued.
  const lastSocketMessageAt = useRef(0);

  const query = useQuery({
    queryKey: HALL_QUERY_KEY,
    queryFn: async () => {
      const requestStartedAt = Date.now();
      const snapshot = await api.hall();
      if (lastSocketMessageAt.current >= requestStartedAt) {
        const current = queryClient.getQueryData<HallSnapshotResponse>(HALL_QUERY_KEY);
        if (current) return current;
      }
      return snapshot;
    },
    // Fast poll while the socket is down. While it is up, still refetch slowly as a
    // safety net: the socket can stay open even if the server's LISTEN connection to
    // Postgres died, and then no pushes would ever arrive.
    refetchInterval: connected ? 60_000 : 5000,
  });

  // Any hall change (a payment is one) moves the till: refresh the day summaries whenever a
  // new snapshot lands, from the socket or from the poll.
  const generatedAt = query.data?.generated_at;
  useEffect(() => {
    if (generatedAt) void queryClient.invalidateQueries({ queryKey: ["business-day-summary"] });
  }, [generatedAt, queryClient]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(wsUrl());
      socket.onopen = () => {
        retryCount.current = 0;
        setConnected(true);
      };
      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as HallSnapshotResponse;
        lastSocketMessageAt.current = Date.now();
        updateClockOffset(snapshot.generated_at);
        queryClient.setQueryData(HALL_QUERY_KEY, snapshot);
      };
      socket.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** retryCount.current, 15000);
        retryCount.current += 1;
        retryTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [queryClient]);

  return { data: query.data, connected };
}
