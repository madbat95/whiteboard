import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasBoard } from "@/components/canvas-board";
import type { BoardObject } from "@shared/contract";

function renderBoard(overrides: Partial<React.ComponentProps<typeof CanvasBoard>> = {}) {
  const props: React.ComponentProps<typeof CanvasBoard> = {
    objects: [],
    tool: "rectangle",
    strokeColor: "#000000",
    fillColor: null,
    strokeWidth: 2,
    selectedId: null,
    onSelect: vi.fn(),
    onCreateObject: vi.fn(),
    onUpdateObject: vi.fn(),
    onDeleteObject: vi.fn(),
    ...overrides,
  };
  render(<CanvasBoard {...props} />);
  return props;
}

describe("CanvasBoard", () => {
  it("renders a canvas surface", () => {
    renderBoard();
    expect(screen.getByTestId("canvas-surface")).toBeInTheDocument();
  });

  it("creates a rectangle object on drag with the rectangle tool", () => {
    const props = renderBoard({ tool: "rectangle" });
    const canvas = screen.getByTestId("canvas-surface");

    // jsdom returns a 0-sized bounding rect by default; that's fine since
    // getPoint only depends on clientX/clientY deltas from rect.left/top (0).
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 40, pointerId: 1 });

    expect(props.onCreateObject).toHaveBeenCalledTimes(1);
    const created = (props.onCreateObject as any).mock.calls[0][0] as BoardObject;
    expect(created.type).toBe("rectangle");
    if (created.type === "rectangle") {
      expect(created.width).toBeGreaterThan(0);
      expect(created.height).toBeGreaterThan(0);
    }
  });

  it("does not create a degenerate rectangle on a plain click with no drag", () => {
    const props = renderBoard({ tool: "rectangle" });
    const canvas = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(props.onCreateObject).not.toHaveBeenCalled();
  });

  it("selects an object under the pointer with the select tool", () => {
    const rect: BoardObject = {
      id: "obj-1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: "#000",
      fillColor: "#fff",
      strokeWidth: 1,
    };
    const props = renderBoard({ tool: "select", objects: [rect] });
    const canvas = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(props.onSelect).toHaveBeenCalledWith("obj-1");
  });

  it("deletes the hit object with the eraser tool", () => {
    const rect: BoardObject = {
      id: "obj-1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: "#000",
      fillColor: "#fff",
      strokeWidth: 1,
    };
    const props = renderBoard({ tool: "eraser", objects: [rect] });
    const canvas = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(props.onDeleteObject).toHaveBeenCalledWith("obj-1");
  });

  it("opens a text input on click with the text tool and commits on blur", () => {
    const props = renderBoard({ tool: "text" });
    const canvas = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    const input = screen.getByTestId("text-editor-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.blur(input);
    expect(props.onCreateObject).toHaveBeenCalledTimes(1);
    const created = (props.onCreateObject as any).mock.calls[0][0] as BoardObject;
    expect(created.type).toBe("text");
    if (created.type === "text") expect(created.content).toBe("hello");
  });
});
