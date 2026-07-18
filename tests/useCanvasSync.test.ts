import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasSync } from "@/hooks/useCanvasSync";
import { createMockSocket } from "./mocks/socket";
import type { BoardObject } from "@shared/contract";

function setup(socket = createMockSocket()) {
  const socketRef = { current: socket as any };
  const utils = renderHook(() =>
    useCanvasSync({ roomId: "room-1", socketRef, connected: true })
  );
  return { socket, socketRef, ...utils };
}

describe("useCanvasSync", () => {
  it("requests room:join on mount", () => {
    const { socket } = setup();
    expect(socket.emit).toHaveBeenCalledWith("room:join", { roomId: "room-1" });
  });

  it("hydrates objects and users from room:state", () => {
    const { socket, result } = setup();
    const obj: BoardObject = {
      id: "o1",
      type: "line",
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      strokeColor: "#000",
      strokeWidth: 2,
    };
    act(() => {
      socket.__trigger("room:state", {
        roomId: "room-1",
        objects: [obj],
        users: [{ id: "u1", name: "Ada", avatarUrl: null, color: "#f00" }],
        lastSeq: 5,
      });
    });
    expect(result.current.objects).toEqual([obj]);
    expect(result.current.users).toHaveLength(1);
    expect(result.current.joined).toBe(true);
  });

  it("emits object:create with a locally-optimistic seq and applies it optimistically", () => {
    const { socket, result } = setup();
    const obj: BoardObject = {
      id: "o2",
      type: "text",
      x: 5,
      y: 5,
      content: "hi",
      fontSize: 16,
      color: "#000",
    };
    act(() => {
      result.current.createObject(obj);
    });
    expect(result.current.objects).toContainEqual(obj);
    expect(socket.emit).toHaveBeenCalledWith(
      "object:create",
      expect.objectContaining({ roomId: "room-1", object: obj, seq: expect.any(Number) })
    );
  });

  it("applies incoming object:created without duplicating locally-created objects", () => {
    const { socket, result } = setup();
    const obj: BoardObject = {
      id: "o3",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      strokeColor: "#000",
      fillColor: null,
      strokeWidth: 1,
    };
    act(() => {
      socket.__trigger("object:created", { roomId: "room-1", object: obj, seq: 1 });
    });
    expect(result.current.objects).toEqual([obj]);

    // Duplicate rebroadcast should not double-insert.
    act(() => {
      socket.__trigger("object:created", { roomId: "room-1", object: obj, seq: 2 });
    });
    expect(result.current.objects).toHaveLength(1);
  });

  it("applies object:updated and object:deleted from the server", () => {
    const { socket, result } = setup();
    const obj: BoardObject = {
      id: "o4",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      strokeColor: "#000",
      fillColor: null,
      strokeWidth: 1,
    };
    act(() => {
      socket.__trigger("object:created", { roomId: "room-1", object: obj, seq: 1 });
    });
    act(() => {
      socket.__trigger("object:updated", {
        roomId: "room-1",
        patch: { id: "o4", x: 50 },
        seq: 2,
      });
    });
    expect(result.current.objects[0]).toMatchObject({ id: "o4", x: 50 });

    act(() => {
      socket.__trigger("object:deleted", { roomId: "room-1", objectId: "o4", seq: 3 });
    });
    expect(result.current.objects).toHaveLength(0);
  });

  it("re-requests room:join on room:resync-required", () => {
    const { socket } = setup();
    (socket.emit as any).mockClear();
    act(() => {
      socket.__trigger("room:resync-required", { roomId: "room-1" });
    });
    expect(socket.emit).toHaveBeenCalledWith("room:join", { roomId: "room-1" });
  });

  it("undo emits history:undo with the inverse op and applies it locally", () => {
    const { socket, result } = setup();
    const obj: BoardObject = {
      id: "o5",
      type: "line",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      strokeColor: "#000",
      strokeWidth: 1,
    };
    act(() => {
      result.current.createObject(obj);
    });
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(result.current.objects).toHaveLength(0);
    expect(socket.emit).toHaveBeenCalledWith(
      "history:undo",
      expect.objectContaining({
        roomId: "room-1",
        inverseOp: { kind: "delete", objectId: "o5", object: obj },
      })
    );
  });

  it("applies incoming history:undone/history:redone from other clients", () => {
    const { socket, result } = setup();
    const obj: BoardObject = {
      id: "o6",
      type: "line",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      strokeColor: "#000",
      strokeWidth: 1,
    };
    act(() => {
      socket.__trigger("object:created", { roomId: "room-1", object: obj, seq: 1 });
    });
    act(() => {
      socket.__trigger("history:undone", {
        roomId: "room-1",
        inverseOp: { kind: "delete", objectId: "o6", object: obj },
        seq: 2,
      });
    });
    expect(result.current.objects).toHaveLength(0);

    act(() => {
      socket.__trigger("history:redone", {
        roomId: "room-1",
        op: { kind: "create", object: obj },
        seq: 3,
      });
    });
    expect(result.current.objects).toEqual([obj]);
  });
});
