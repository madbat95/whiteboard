"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomId, UserId } from "@shared/contract";
import type { WhiteboardSocket } from "./useWebSocket";

const THROTTLE_MS = 50; // max 20/sec per contract §4 resolved decision.

export interface RemoteCursor {
  userId: UserId;
  x: number;
  y: number;
}

interface UseCursorTrackingOptions {
  roomId: RoomId;
  socketRef: React.MutableRefObject<WhiteboardSocket | null>;
  connected: boolean;
  /** Only emit cursor:move once room:join has completed — sending earlier
   * races the server's per-socket room membership check and triggers a
   * spurious room:error. */
  joined: boolean;
}

/**
 * Emits cursor:move throttled to max 20/sec client-side, and tracks other
 * users' cursors from cursor:update (never echoed back to the sender per
 * contract comment).
 */
export function useCursorTracking({ roomId, socketRef, connected, joined }: UseCursorTrackingOptions) {
  const [cursors, setCursors] = useState<Record<UserId, RemoteCursor>>({});
  const lastSentRef = useRef(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;

    function onCursorUpdate(payload: { roomId: RoomId; userId: UserId; x: number; y: number }) {
      if (payload.roomId !== roomId) return;
      setCursors((prev) => ({ ...prev, [payload.userId]: { userId: payload.userId, x: payload.x, y: payload.y } }));
    }

    socket.on("cursor:update", onCursorUpdate);
    return () => {
      socket.off("cursor:update", onCursorUpdate);
    };
  }, [roomId, connected, socketRef]);

  const emitCursor = useCallback(
    (x: number, y: number) => {
      const socket = socketRef.current;
      if (!socket || !joined) return;
      const now = Date.now();
      const elapsed = now - lastSentRef.current;

      const send = (px: number, py: number) => {
        lastSentRef.current = Date.now();
        socket.emit("cursor:move", { roomId, x: px, y: py });
      };

      if (elapsed >= THROTTLE_MS) {
        send(x, y);
        pendingRef.current = null;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      } else {
        pendingRef.current = { x, y };
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            if (pendingRef.current) {
              send(pendingRef.current.x, pendingRef.current.y);
              pendingRef.current = null;
            }
          }, THROTTLE_MS - elapsed);
        }
      }
    },
    [roomId, socketRef, joined]
  );

  const removeUser = useCallback((userId: UserId) => {
    setCursors((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { cursors, emitCursor, removeUser };
}
