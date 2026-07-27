"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardObject, BoardObjectPatch, ObjectId, Point, ToolType } from "@shared/contract";
import { hitTestAll, translateObjectPatch } from "@/lib/canvas-geometry";
import { renderScene } from "@/lib/canvas-render";
import { makeObjectId } from "@/hooks/useCanvasSync";

export interface CanvasBoardProps {
  objects: BoardObject[];
  tool: ToolType;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  selectedId: ObjectId | null;
  onSelect: (id: ObjectId | null) => void;
  onCreateObject: (object: BoardObject) => void;
  onUpdateObject: (patch: BoardObjectPatch) => void;
  onDeleteObject: (id: ObjectId) => void;
  onCursorMove?: (x: number, y: number) => void;
  className?: string;
}

/**
 * Local-rendering canvas surface: freehand draw, rectangle, ellipse, line,
 * text, per the BoardObject union in the contract. All mutations are
 * reported to the parent via onCreateObject/onUpdateObject/onDeleteObject,
 * which the board page wires into useCanvasSync for sync + history.
 */
export function CanvasBoard({
  objects,
  tool,
  strokeColor,
  fillColor,
  strokeWidth,
  selectedId,
  onSelect,
  onCreateObject,
  onUpdateObject,
  onDeleteObject,
  onCursorMove,
  className,
}: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<BoardObject | null>(null);
  const drawingRef = useRef<{ mode: "draw" | "drag"; startPoint: Point; objectId?: ObjectId } | null>(null);
  const [textEditor, setTextEditor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[text-tool] textEditor state:", textEditor);
  }, [textEditor]);

  // Resize canvas to fill container, accounting for devicePixelRatio.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      renderScene(canvas, objects, draft, selectedId);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderScene(canvas, objects, draft, selectedId);
  }, [objects, draft, selectedId]);

  const getPoint = useCallback((e: React.PointerEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const point = getPoint(e);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      // eslint-disable-next-line no-console
      console.log("[text-tool] pointerdown, tool =", tool, "point =", point);

      if (tool === "select") {
        const hit = hitTestAll(objects, point);
        onSelect(hit?.id ?? null);
        if (hit) {
          drawingRef.current = { mode: "drag", startPoint: point, objectId: hit.id };
        }
        return;
      }

      if (tool === "eraser") {
        const hit = hitTestAll(objects, point);
        if (hit) onDeleteObject(hit.id);
        return;
      }

      if (tool === "text") {
        setTextEditor({ x: point.x, y: point.y });
        return;
      }

      if (tool === "pen") {
        const id = makeObjectId();
        drawingRef.current = { mode: "draw", startPoint: point, objectId: id };
        setDraft({ id, type: "path", points: [point], strokeColor, strokeWidth });
        return;
      }

      if (tool === "rectangle" || tool === "ellipse") {
        const id = makeObjectId();
        drawingRef.current = { mode: "draw", startPoint: point, objectId: id };
        setDraft({
          id,
          type: tool,
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
          strokeColor,
          fillColor,
          strokeWidth,
        });
        return;
      }

      if (tool === "line") {
        const id = makeObjectId();
        drawingRef.current = { mode: "draw", startPoint: point, objectId: id };
        setDraft({ id, type: "line", x1: point.x, y1: point.y, x2: point.x, y2: point.y, strokeColor, strokeWidth });
        return;
      }
    },
    [tool, objects, strokeColor, fillColor, strokeWidth, onSelect, onDeleteObject, getPoint]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const point = getPoint(e);
      onCursorMove?.(point.x, point.y);

      const active = drawingRef.current;
      if (!active) return;

      if (active.mode === "drag" && active.objectId) {
        const dx = point.x - active.startPoint.x;
        const dy = point.y - active.startPoint.y;
        const obj = objects.find((o) => o.id === active.objectId);
        if (obj) {
          const patch = translateObjectPatch(obj, dx, dy);
          onUpdateObject({ id: obj.id, ...patch } as BoardObjectPatch);
        }
        drawingRef.current = { ...active, startPoint: point };
        return;
      }

      setDraft((prev) => {
        if (!prev) return prev;
        if (prev.type === "path") {
          return { ...prev, points: [...prev.points, point] };
        }
        if (prev.type === "rectangle" || prev.type === "ellipse") {
          const x = Math.min(active.startPoint.x, point.x);
          const y = Math.min(active.startPoint.y, point.y);
          const width = Math.abs(point.x - active.startPoint.x);
          const height = Math.abs(point.y - active.startPoint.y);
          return { ...prev, x, y, width, height };
        }
        if (prev.type === "line") {
          return { ...prev, x2: point.x, y2: point.y };
        }
        return prev;
      });
    },
    [objects, onUpdateObject, onCursorMove, getPoint]
  );

  const handlePointerUp = useCallback(() => {
    const active = drawingRef.current;
    drawingRef.current = null;
    if (!active) return;

    if (active.mode === "drag") return;

    setDraft((prev) => {
      if (prev) {
        // Ignore degenerate shapes (accidental clicks with no drag).
        const isDegenerate =
          (prev.type === "rectangle" || prev.type === "ellipse") && prev.width < 1 && prev.height < 1;
        const isEmptyPath = prev.type === "path" && prev.points.length < 2;
        if (!isDegenerate && !isEmptyPath) {
          onCreateObject(prev);
        }
      }
      return null;
    });
  }, [onCreateObject]);

  const commitText = useCallback(
    (value: string) => {
      if (textEditor && value.trim()) {
        onCreateObject({
          id: makeObjectId(),
          type: "text",
          x: textEditor.x,
          y: textEditor.y,
          content: value,
          fontSize: 18,
          color: strokeColor,
        });
      }
      setTextEditor(null);
    },
    [textEditor, strokeColor, onCreateObject]
  );

  // Delete key removes the selected object while using the select tool.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && tool === "select" && selectedId) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        onDeleteObject(selectedId);
        onSelect(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tool, selectedId, onDeleteObject, onSelect]);

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        className="touch-none bg-white"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        data-testid="canvas-surface"
      />
      {textEditor && (
        <input
          autoFocus
          data-testid="text-editor-input"
          className="absolute rounded border-2 border-blue-500 bg-white px-1 text-sm text-black outline-none"
          style={{ left: textEditor.x, top: textEditor.y - 12, minWidth: 120, zIndex: 50 }}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setTextEditor(null);
          }}
        />
      )}
    </div>
  );
}
