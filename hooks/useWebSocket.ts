"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@shared/contract";

export type WhiteboardSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

interface UseWebSocketOptions {
  /** JWT to send as `auth: { token }` per contract §2 header comment. */
  token: string | undefined;
  /** If false, the socket is not created/connected (e.g. waiting on auth). */
  enabled?: boolean;
}

/**
 * Thin typed wrapper around socket.io-client, built strictly against
 * ClientToServerEvents/ServerToClientEvents from /shared/contract.ts.
 *
 * The backend gateway may not be reachable yet (built concurrently) — this
 * hook does not block on a live connection. socket.io's default
 * reconnection behavior is left enabled so it keeps retrying in the
 * background; `status` surfaces connect/disconnect/error transitions so UI
 * can show a "reconnecting…" indicator instead of hanging silently.
 */
export function useWebSocket({ token, enabled = true }: UseWebSocketOptions) {
  const socketRef = useRef<WhiteboardSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !token) {
      setStatus("idle");
      return;
    }

    const base = process.env.NEXT_PUBLIC_API_URL;
    if (!base) {
      console.warn("NEXT_PUBLIC_API_URL not set — cannot open WebSocket connection.");
      setStatus("error");
      setLastError("NEXT_PUBLIC_API_URL is not configured");
      return;
    }

    setStatus("connecting");

    const socket: WhiteboardSocket = io(base, {
      auth: { token },
      // Default reconnection behavior is fine per task brief.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    function onConnect() {
      setStatus("connected");
      setLastError(null);
    }
    function onDisconnect() {
      setStatus("disconnected");
    }
    function onConnectError(err: Error) {
      setStatus("error");
      setLastError(err.message);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, enabled]);

  return { socketRef, status, lastError };
}
