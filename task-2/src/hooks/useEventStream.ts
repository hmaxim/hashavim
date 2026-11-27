"use client";

import { useEffect, useRef } from "react";
import type { Snapshot, TaskEvent } from "@/src/lib/types";
import { useBoardStoreApi } from "@/src/state/store";

type EventSourceFactory = (url: string) => EventSource;

const defaultEventSource: EventSourceFactory = (url) => new EventSource(url);

/**
 * Opens one SSE connection to /api/events. Safe under StrictMode double-mount:
 * the previous source is closed before a new one is created, and a generation
 * counter ignores late messages from a disposed source.
 */
export function useEventStream(
  createEventSource: EventSourceFactory = defaultEventSource,
): void {
  const store = useBoardStoreApi();
  const sourceRef = useRef<EventSource | null>(null);
  const genRef = useRef(0);
  const factoryRef = useRef(createEventSource);
  factoryRef.current = createEventSource;

  useEffect(() => {
    const gen = ++genRef.current;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed || gen !== genRef.current) return;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }

      store.getState().dispatch({ type: "clearNeedsResync" });

      const source = factoryRef.current("/api/events");
      sourceRef.current = source;

      source.addEventListener("snapshot", (msg) => {
        if (gen !== genRef.current) return;
        const snapshot = JSON.parse((msg as MessageEvent).data) as Snapshot;
        store.getState().dispatch({ type: "snapshot", snapshot });
        store.getState().dispatch({ type: "connection", status: "connected" });
      });

      source.addEventListener("event", (msg) => {
        if (gen !== genRef.current) return;
        const event = JSON.parse((msg as MessageEvent).data) as TaskEvent;
        store.getState().dispatch({ type: "server", event });
        if (store.getState().needsResync) {
          store.getState().dispatch({
            type: "connection",
            status: "reconnecting",
          });
          source.close();
          sourceRef.current = null;
          reconnectTimer = setTimeout(connect, 250);
        }
      });

      source.onerror = () => {
        if (gen !== genRef.current || closed) return;
        store.getState().dispatch({
          type: "connection",
          status: "reconnecting",
        });
        // Only recreate when the browser has fully closed the socket.
        // Calling close() on transient errors causes a reconnect storm.
        if (source.readyState === EventSource.CLOSED) {
          sourceRef.current = null;
          reconnectTimer = setTimeout(connect, 1000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, [store]);
}
