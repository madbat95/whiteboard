/**
 * SHARED CONTRACT — single source of truth for frontend <-> backend.
 *
 * Both /app (frontend-agent) and /server (backend-agent) MUST import
 * types from this file rather than redefining them. If an event,
 * payload, or route needed for implementation is missing or ambiguous
 * here, STOP and report back instead of guessing — do not invent
 * shapes on either side.
 *
 * Status: APPROVED for v1 implementation.
 */

// ============================================================
// 1. Core domain types
// ============================================================

export type UserId = string; // uuid
export type RoomId = string; // uuid, also used as the join-link slug
export type ObjectId = string; // uuid, id of a shape/text/stroke on the board

export interface UserSummary {
  id: UserId;
  name: string;
  avatarUrl: string | null;
  color: string; // stable per-user color, assigned server-side on join, used for cursor + avatar ring
}

export type ToolType = "select" | "pen" | "rectangle" | "ellipse" | "line" | "text" | "eraser";

export interface Point {
  x: number;
  y: number;
}

/** Discriminated union of everything that can live on the board. */
export type BoardObject =
  | {
      id: ObjectId;
      type: "path";
      points: Point[];
      strokeColor: string;
      strokeWidth: number;
    }
  | {
      id: ObjectId;
      type: "rectangle" | "ellipse";
      x: number;
      y: number;
      width: number;
      height: number;
      strokeColor: string;
      fillColor: string | null;
      strokeWidth: number;
    }
  | {
      id: ObjectId;
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      strokeColor: string;
      strokeWidth: number;
    }
  | {
      id: ObjectId;
      type: "text";
      x: number;
      y: number;
      content: string;
      fontSize: number;
      color: string;
    };

export type BoardObjectPatch = Partial<BoardObject> & { id: ObjectId };

// ============================================================
// 2. WebSocket contract (socket.io)
// ============================================================
//
// Connection: client connects with `auth: { token: <JWT> }`.
// Server verifies JWT on `connection`; rejects with error event
// "connect_error" (socket.io built-in) if invalid.
//
// Namespace: default "/" — single namespace for v1, room isolation
// via socket.io rooms keyed by RoomId.

/** Events the CLIENT emits to the SERVER. */
export interface ClientToServerEvents {
  /** Join a room. Server responds with "room:state" or "room:error". */
  "room:join": (payload: { roomId: RoomId }) => void;

  /** Leave current room (also implicit on disconnect). */
  "room:leave": (payload: { roomId: RoomId }) => void;

  /** Cursor moved. High frequency — server rebroadcasts, does NOT persist. */
  "cursor:move": (payload: { roomId: RoomId; x: number; y: number }) => void;

  /** A new object was created (finalized stroke/shape/text). */
  "object:create": (payload: { roomId: RoomId; object: BoardObject; seq: number }) => void;

  /** An existing object was updated (move/resize/recolor/edit text). */
  "object:update": (payload: { roomId: RoomId; patch: BoardObjectPatch; seq: number }) => void;

  /** An object was deleted (includes eraser). */
  "object:delete": (payload: { roomId: RoomId; objectId: ObjectId; seq: number }) => void;

  /**
   * Undo/redo is client-decided (which op to invert) but must be
   * broadcast so other clients apply the same inverse op. The
   * client sends the resulting op, not a bare "undo" signal.
   */
  "history:undo": (payload: { roomId: RoomId; inverseOp: HistoryOp; seq: number }) => void;
  "history:redo": (payload: { roomId: RoomId; op: HistoryOp; seq: number }) => void;
}

/** Ops used inside history:undo / history:redo payloads. */
export type HistoryOp =
  | { kind: "create"; object: BoardObject }
  | { kind: "update"; patch: BoardObjectPatch; previous: BoardObjectPatch }
  | { kind: "delete"; objectId: ObjectId; object: BoardObject };

/** Events the SERVER emits to the CLIENT. */
export interface ServerToClientEvents {
  /** Sent once after a successful "room:join": full current board + roster. */
  "room:state": (payload: {
    roomId: RoomId;
    objects: BoardObject[];
    users: UserSummary[];
    lastSeq: number;
  }) => void;

  "room:error": (payload: { roomId: RoomId; message: string }) => void;

  /** Another user joined/left — used to update presence UI. */
  "presence:join": (payload: { roomId: RoomId; user: UserSummary }) => void;
  "presence:leave": (payload: { roomId: RoomId; userId: UserId }) => void;

  /** Rebroadcast of another user's cursor. Never echoed back to sender. */
  "cursor:update": (payload: { roomId: RoomId; userId: UserId; x: number; y: number }) => void;

  /** Rebroadcasts of object events, echoed to all clients in room except sender. */
  "object:created": (payload: { roomId: RoomId; object: BoardObject; seq: number }) => void;
  "object:updated": (payload: { roomId: RoomId; patch: BoardObjectPatch; seq: number }) => void;
  "object:deleted": (payload: { roomId: RoomId; objectId: ObjectId; seq: number }) => void;

  "history:undone": (payload: { roomId: RoomId; inverseOp: HistoryOp; seq: number }) => void;
  "history:redone": (payload: { roomId: RoomId; op: HistoryOp; seq: number }) => void;

  /**
   * Server detected the client's seq is behind (e.g. reconnect gap).
   * Client should discard local pending ops and request "room:join"
   * again to resync via full "room:state".
   */
  "room:resync-required": (payload: { roomId: RoomId }) => void;
}

// ============================================================
// 3. REST API contract (NestJS controllers under /server)
// ============================================================
//
// Base path: /api  (proxied from Next.js or called directly, TBD in
// deployment task — see task list)
// Auth: Bearer JWT in Authorization header, same token used for WS.

/** POST /api/boards — create a new room/board. */
export interface CreateBoardRequest {
  name: string;
}
export interface CreateBoardResponse {
  roomId: RoomId;
  name: string;
  ownerId: UserId;
  createdAt: string; // ISO 8601
}

/** GET /api/boards/:roomId — fetch board metadata + latest persisted snapshot. */
export interface GetBoardResponse {
  roomId: RoomId;
  name: string;
  ownerId: UserId;
  objects: BoardObject[];
  updatedAt: string; // ISO 8601
}

/** GET /api/boards — list boards owned by or shared with the current user. */
export interface ListBoardsResponse {
  boards: Array<{
    roomId: RoomId;
    name: string;
    updatedAt: string;
  }>;
}

/**
 * PATCH /api/boards/:roomId — explicit snapshot checkpoint.
 * Server also auto-checkpoints periodically/on-empty-room; this route
 * covers manual "save" and is what the frontend calls before navigating away.
 */
export interface SaveBoardSnapshotRequest {
  objects: BoardObject[];
}
export interface SaveBoardSnapshotResponse {
  roomId: RoomId;
  updatedAt: string;
}

/** DELETE /api/boards/:roomId — owner-only. */
export type DeleteBoardResponse = { roomId: RoomId; deleted: true };

// ============================================================
// 4. Resolved decisions (v1)
// ============================================================
//
// - Room size / rate limit: no hard cap on participants for v1.
//   `cursor:move` is throttled CLIENT-SIDE to max 20/sec per user
//   (~50ms) before emit. Server does not additionally rate-limit in
//   v1, but the gateway handler should be written so a limiter can
//   be added later without a payload change.
//
// - REST transport: frontend calls the backend URL DIRECTLY
//   (cross-origin), not proxied through Next.js route handlers.
//   Backend enables CORS for the deployed Vercel origin (+
//   localhost:3000 in dev). Base URL is read from
//   NEXT_PUBLIC_API_URL on the frontend.
//
// - Snapshot checkpoint cadence: server auto-checkpoints a room
//   every 30s IF there were ops since the last checkpoint, AND
//   immediately when the last user leaves a room (room goes empty).
//   The manual PATCH route is additionally called by the frontend
//   on explicit "Save" and on page unload (best-effort beacon).
//
// - Conflict resolution: last-write-wins by `seq` (server-assigned,
//   monotonic per room). The server is the sole assigner of `seq` —
//   despite ClientToServerEvents carrying a `seq` field, that field
//   is the client's locally-optimistic sequence number used only for
//   its own pending-ops reconciliation; the server ignores it for
//   ordering and stamps its own `seq` on the rebroadcast event. No
//   operational-transform / CRDT merge in v1 — acceptable for a
//   portfolio project's scale.
//
// - Auth transport for WS: JWT passed as `auth: { token }` in the
//   socket.io handshake (see §2 header comment). Same JWT (NextAuth-
//   issued, HS256, shared secret via NEXTAUTH_SECRET / JWT_SECRET
//   env var on both sides) is sent as `Authorization: Bearer <token>`
//   on REST calls.
