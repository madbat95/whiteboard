"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import type { BoardObjectPatch, ObjectId, RoomId, ToolType } from "@shared/contract";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useCanvasSync } from "@/hooks/useCanvasSync";
import { useCursorTracking } from "@/hooks/useCursorTracking";
import { CanvasBoard } from "@/components/canvas-board";
import { Toolbar } from "@/components/toolbar";
import { PresenceAvatars } from "@/components/presence-avatars";
import { CursorLayer } from "@/components/cursor-layer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { boardsApi } from "@/lib/api";

export function BoardClient({ roomId }: { roomId: RoomId }) {
  const { data: session, status } = useSession();
  const token = session?.accessToken;

  const { socketRef, status: wsStatus, lastError } = useWebSocket({
    token,
    enabled: status === "authenticated",
  });
  const connected = wsStatus === "connected";

  const [roomError, setRoomError] = useState<string | null>(null);
  const {
    objects,
    users,
    joined,
    createObject,
    updateObject,
    deleteObject,
    undo,
    redo,
    canUndo,
    canRedo,
    replaceAll,
  } = useCanvasSync({
    roomId,
    socketRef,
    connected,
    onRoomState: () => setRoomError(null),
    onRoomError: (message) => setRoomError(message),
  });

  const { cursors, emitCursor } = useCursorTracking({ roomId, socketRef, connected, joined });

  const [tool, setTool] = useState<ToolType>("pen");
  const [strokeColor, setStrokeColor] = useState("#0f172a");
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedId, setSelectedId] = useState<ObjectId | null>(null);
  const [saving, setSaving] = useState(false);
  const [boardName, setBoardName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // F10: hydrate from REST on mount.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    boardsApi
      .get(token, roomId)
      .then((res) => {
        if (cancelled) return;
        replaceAll(res.objects);
        setBoardName(res.name);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load board");
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, roomId]);

  // Best-effort save beacon on unload.
  useEffect(() => {
    function onUnload() {
      if (token) boardsApi.saveBeacon(token, roomId, { objects });
    }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [token, roomId, objects]);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    try {
      await boardsApi.save(token, roomId, { objects });
    } catch (err) {
      console.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  }

  function handleUpdateObject(patch: BoardObjectPatch) {
    updateObject(patch);
  }

  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/board/${roomId}` : "";

  if (status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">Loading session…</div>;
  }

  if (status !== "authenticated") {
    return <BoardSignIn />;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="text-sm font-medium">{boardName ?? "Board"}</h1>
        <span
          className="rounded px-1.5 py-0.5 text-xs"
          data-testid="ws-status"
          data-status={wsStatus}
        >
          {wsStatus === "connected"
            ? "Live"
            : wsStatus === "connecting"
              ? "Connecting…"
              : wsStatus === "disconnected"
                ? "Reconnecting…"
                : wsStatus === "error"
                  ? "Offline"
                  : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(inviteUrl);
            setCopied(true);
          }}
        >
          {copied ? "Copied!" : "Copy invite link"}
        </Button>
        <div className="ml-auto">
          <PresenceAvatars users={users} />
        </div>
      </header>

      <Toolbar
        tool={tool}
        onToolChange={setTool}
        strokeColor={strokeColor}
        onStrokeColorChange={setStrokeColor}
        fillColor={fillColor}
        onFillColorChange={setFillColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={handleSave}
        saving={saving}
      />

      {(roomError || loadError || lastError) && (
        <div className="border-b bg-destructive/10 px-4 py-1 text-xs text-destructive">
          {roomError || loadError || lastError}
        </div>
      )}

      <div className="relative flex-1">
        {!hydrated && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              Loading board…
            </div>
          </div>
        )}
        <CanvasBoard
          objects={objects}
          tool={tool}
          strokeColor={strokeColor}
          fillColor={fillColor}
          strokeWidth={strokeWidth}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreateObject={createObject}
          onUpdateObject={handleUpdateObject}
          onDeleteObject={deleteObject}
          onCursorMove={emitCursor}
          className="absolute inset-0"
        />
        <CursorLayer cursors={cursors} users={users} />
      </div>
    </div>
  );
}

/** Inline sign-in for someone who opened an invite link while signed out —
 * signs in without leaving the page so they land straight in the room they
 * clicked into, instead of being redirected home and losing the roomId. */
function BoardSignIn() {
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSubmitting(true);
    await signIn("credentials", { name: displayName.trim(), redirect: false });
    setSubmitting(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Join board</h1>
        <p className="text-sm text-muted-foreground">Enter your name to join this board.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border p-4">
        <Label htmlFor="boardDisplayName">Your name</Label>
        <Input
          id="boardDisplayName"
          placeholder="e.g. Ada"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Button type="submit" disabled={!displayName.trim() || submitting}>
          {submitting ? "Joining…" : "Join"}
        </Button>
      </form>
    </main>
  );
}
