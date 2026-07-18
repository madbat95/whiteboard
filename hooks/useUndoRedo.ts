"use client";

import { useCallback, useRef, useState } from "react";
import type { HistoryOp } from "@shared/contract";

/**
 * Local history stack of HistoryOp (per contract's HistoryOp union).
 * This hook only manages the local undo/redo stacks and computes the
 * inverse op; it does NOT emit over the socket — the caller (useCanvasSync)
 * wires `pushAndEmit`/`undo`/`redo` results into `history:undo`/`history:redo`.
 */
export function useUndoRedo() {
  const undoStack = useRef<HistoryOp[]>([]);
  const redoStack = useRef<HistoryOp[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  function sync() {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }

  /** Record a local op (already applied to canvas state) onto the undo stack. */
  const record = useCallback((op: HistoryOp) => {
    undoStack.current.push(op);
    redoStack.current = [];
    sync();
  }, []);

  /** Pop the last op and return both it and its inverse, or null if empty. */
  const popUndo = useCallback((): { op: HistoryOp; inverse: HistoryOp } | null => {
    const op = undoStack.current.pop();
    if (!op) return null;
    const inverse = invertOp(op);
    redoStack.current.push(op);
    sync();
    return { op, inverse };
  }, []);

  /** Pop the last redo op (the original, non-inverted op) to re-apply. */
  const popRedo = useCallback((): HistoryOp | null => {
    const op = redoStack.current.pop();
    if (!op) return null;
    undoStack.current.push(op);
    sync();
    return op;
  }, []);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    sync();
  }, []);

  return { record, popUndo, popRedo, clear, canUndo, canRedo };
}

/** Compute the inverse of a HistoryOp so undoing it restores prior state. */
export function invertOp(op: HistoryOp): HistoryOp {
  switch (op.kind) {
    case "create":
      return { kind: "delete", objectId: op.object.id, object: op.object };
    case "delete":
      return { kind: "create", object: op.object };
    case "update":
      return { kind: "update", patch: op.previous, previous: op.patch };
  }
}
