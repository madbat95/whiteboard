"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  BoardObject,
  BoardObjectPatch,
  HistoryOp,
  ObjectId,
  RoomId,
  UserSummary,
} from "@shared/contract";
import type { WhiteboardSocket } from "./useWebSocket";
import { useUndoRedo } from "./useUndoRedo";

interface UseCanvasSyncOptions {
  roomId: RoomId;
  socketRef: React.MutableRefObject<WhiteboardSocket | null>;
  connected: boolean;
  /** Called once after a successful room:join with the full room:state payload. */
  onRoomState?: (payload: { objects: BoardObject[]; users: UserSummary[] }) => void;
  /** Called on room:error. */
  onRoomError?: (message: string) => void;
}

/**
 * Owns the authoritative-ish local copy of board objects, mirrors it to the
 * server via object:create/update/delete, and reconciles incoming
 * object:created/updated/deleted / room:state / room:resync-required.
 *
 * Per contract §4: the `seq` this client sends is a locally-optimistic
 * number used only for this client's own pending-ops bookkeeping — the
 * server ignores it for ordering and stamps its own `seq` on rebroadcasts.
 * We track a local monotonically increasing counter for that purpose and
 * also track the last-known server `seq` (from room:state.lastSeq / each
 * incoming event) so we can detect gaps, though the actual resync trigger
 * is server-driven via `room:resync-required`.
 */
export function useCanvasSync({
  roomId,
  socketRef,
  connected,
  onRoomState,
  onRoomError,
}: UseCanvasSyncOptions) {
  const [objects, setObjects] = useState<BoardObject[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [joined, setJoined] = useState(false);
  const localSeqRef = useRef(0);
  const lastServerSeqRef = useRef(0);
  const objectsRef = useRef<BoardObject[]>([]);
  objectsRef.current = objects;

  const history = useUndoRedo();

  const nextSeq = useCallback(() => {
    localSeqRef.current += 1;
    return localSeqRef.current;
  }, []);

  // --- join room + wire listeners -----------------------------------
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected || !roomId) return;

    function requestJoin() {
      socket?.emit("room:join", { roomId });
    }

    function onRoomStateEvt(payload: {
      roomId: RoomId;
      objects: BoardObject[];
      users: UserSummary[];
      lastSeq: number;
    }) {
      if (payload.roomId !== roomId) return;
      setObjects(payload.objects);
      setUsers(payload.users);
      lastServerSeqRef.current = payload.lastSeq;
      setJoined(true);
      history.clear();
      onRoomState?.({ objects: payload.objects, users: payload.users });
    }

    function onRoomErrorEvt(payload: { roomId: RoomId; message: string }) {
      if (payload.roomId !== roomId) return;
      onRoomError?.(payload.message);
    }

    function onResyncRequired(payload: { roomId: RoomId }) {
      if (payload.roomId !== roomId) return;
      // Discard local pending ops and re-request full state.
      setJoined(false);
      requestJoin();
    }

    function onObjectCreated(payload: { roomId: RoomId; object: BoardObject; seq: number }) {
      if (payload.roomId !== roomId) return;
      lastServerSeqRef.current = Math.max(lastServerSeqRef.current, payload.seq);
      setObjects((prev) => {
        if (prev.some((o) => o.id === payload.object.id)) return prev;
        return [...prev, payload.object];
      });
    }

    function onObjectUpdated(payload: { roomId: RoomId; patch: BoardObjectPatch; seq: number }) {
      if (payload.roomId !== roomId) return;
      lastServerSeqRef.current = Math.max(lastServerSeqRef.current, payload.seq);
      setObjects((prev) => prev.map((o) => (o.id === payload.patch.id ? applyPatch(o, payload.patch) : o)));
    }

    function onObjectDeleted(payload: { roomId: RoomId; objectId: ObjectId; seq: number }) {
      if (payload.roomId !== roomId) return;
      lastServerSeqRef.current = Math.max(lastServerSeqRef.current, payload.seq);
      setObjects((prev) => prev.filter((o) => o.id !== payload.objectId));
    }

    function onPresenceJoin(payload: { roomId: RoomId; user: UserSummary }) {
      if (payload.roomId !== roomId) return;
      setUsers((prev) => (prev.some((u) => u.id === payload.user.id) ? prev : [...prev, payload.user]));
    }

    function onPresenceLeave(payload: { roomId: RoomId; userId: string }) {
      if (payload.roomId !== roomId) return;
      setUsers((prev) => prev.filter((u) => u.id !== payload.userId));
    }

    function onHistoryUndone(payload: { roomId: RoomId; inverseOp: HistoryOp; seq: number }) {
      if (payload.roomId !== roomId) return;
      lastServerSeqRef.current = Math.max(lastServerSeqRef.current, payload.seq);
      applyHistoryOpLocally(payload.inverseOp, setObjects);
    }

    function onHistoryRedone(payload: { roomId: RoomId; op: HistoryOp; seq: number }) {
      if (payload.roomId !== roomId) return;
      lastServerSeqRef.current = Math.max(lastServerSeqRef.current, payload.seq);
      applyHistoryOpLocally(payload.op, setObjects);
    }

    socket.on("room:state", onRoomStateEvt);
    socket.on("room:error", onRoomErrorEvt);
    socket.on("room:resync-required", onResyncRequired);
    socket.on("object:created", onObjectCreated);
    socket.on("object:updated", onObjectUpdated);
    socket.on("object:deleted", onObjectDeleted);
    socket.on("presence:join", onPresenceJoin);
    socket.on("presence:leave", onPresenceLeave);
    socket.on("history:undone", onHistoryUndone);
    socket.on("history:redone", onHistoryRedone);

    requestJoin();

    return () => {
      socket.off("room:state", onRoomStateEvt);
      socket.off("room:error", onRoomErrorEvt);
      socket.off("room:resync-required", onResyncRequired);
      socket.off("object:created", onObjectCreated);
      socket.off("object:updated", onObjectUpdated);
      socket.off("object:deleted", onObjectDeleted);
      socket.off("presence:join", onPresenceJoin);
      socket.off("presence:leave", onPresenceLeave);
      socket.off("history:undone", onHistoryUndone);
      socket.off("history:redone", onHistoryRedone);
      socket.emit("room:leave", { roomId });
      setJoined(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, connected]);

  // --- local mutations (optimistic) -----------------------------------

  const createObject = useCallback(
    (object: BoardObject, opts?: { skipHistory?: boolean }) => {
      setObjects((prev) => [...prev, object]);
      socketRef.current?.emit("object:create", { roomId, object, seq: nextSeq() });
      if (!opts?.skipHistory) history.record({ kind: "create", object });
    },
    [roomId, socketRef, nextSeq, history]
  );

  const updateObject = useCallback(
    (patch: BoardObjectPatch, opts?: { skipHistory?: boolean }) => {
      const previous = objectsRef.current.find((o) => o.id === patch.id);
      setObjects((prev) => prev.map((o) => (o.id === patch.id ? applyPatch(o, patch) : o)));
      socketRef.current?.emit("object:update", { roomId, patch, seq: nextSeq() });
      if (!opts?.skipHistory && previous) {
        const previousPatch: BoardObjectPatch = { id: patch.id, ...pick(previous, Object.keys(patch)) };
        history.record({ kind: "update", patch, previous: previousPatch });
      }
    },
    [roomId, socketRef, nextSeq, history]
  );

  const deleteObject = useCallback(
    (objectId: ObjectId, opts?: { skipHistory?: boolean }) => {
      const previous = objectsRef.current.find((o) => o.id === objectId);
      setObjects((prev) => prev.filter((o) => o.id !== objectId));
      socketRef.current?.emit("object:delete", { roomId, objectId, seq: nextSeq() });
      if (!opts?.skipHistory && previous) {
        history.record({ kind: "delete", objectId, object: previous });
      }
    },
    [roomId, socketRef, nextSeq, history]
  );

  const undo = useCallback(() => {
    const result = history.popUndo();
    if (!result) return;
    applyHistoryOpLocally(result.inverse, setObjects);
    socketRef.current?.emit("history:undo", { roomId, inverseOp: result.inverse, seq: nextSeq() });
  }, [history, roomId, socketRef, nextSeq]);

  const redo = useCallback(() => {
    const op = history.popRedo();
    if (!op) return;
    applyHistoryOpLocally(op, setObjects);
    socketRef.current?.emit("history:redo", { roomId, op, seq: nextSeq() });
  }, [history, roomId, socketRef, nextSeq]);

  /** Replace all local objects, e.g. after GET /api/boards/:roomId hydration. */
  const replaceAll = useCallback((next: BoardObject[]) => {
    setObjects(next);
    history.clear();
  }, [history]);

  return {
    objects,
    users,
    joined,
    createObject,
    updateObject,
    deleteObject,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    replaceAll,
  };
}

function applyPatch(obj: BoardObject, patch: BoardObjectPatch): BoardObject {
  return { ...obj, ...patch } as BoardObject;
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (k in obj) (out as any)[k] = (obj as any)[k];
  }
  return out;
}

function applyHistoryOpLocally(
  op: HistoryOp,
  setObjects: React.Dispatch<React.SetStateAction<BoardObject[]>>
) {
  switch (op.kind) {
    case "create":
      setObjects((prev) => (prev.some((o) => o.id === op.object.id) ? prev : [...prev, op.object]));
      break;
    case "delete":
      setObjects((prev) => prev.filter((o) => o.id !== op.objectId));
      break;
    case "update":
      setObjects((prev) => prev.map((o) => (o.id === op.patch.id ? applyPatch(o, op.patch) : o)));
      break;
  }
}

export function makeObjectId(): ObjectId {
  return uuidv4();
}
