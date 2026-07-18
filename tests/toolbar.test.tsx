import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toolbar } from "@/components/toolbar";

function renderToolbar(overrides: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
  const props: React.ComponentProps<typeof Toolbar> = {
    tool: "pen",
    onToolChange: vi.fn(),
    strokeColor: "#0f172a",
    onStrokeColorChange: vi.fn(),
    fillColor: null,
    onFillColorChange: vi.fn(),
    strokeWidth: 3,
    onStrokeWidthChange: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  render(<Toolbar {...props} />);
  return props;
}

describe("Toolbar", () => {
  it("renders all tool buttons", () => {
    renderToolbar();
    expect(screen.getByTestId("tool-select")).toBeInTheDocument();
    expect(screen.getByTestId("tool-pen")).toBeInTheDocument();
    expect(screen.getByTestId("tool-rectangle")).toBeInTheDocument();
    expect(screen.getByTestId("tool-ellipse")).toBeInTheDocument();
    expect(screen.getByTestId("tool-line")).toBeInTheDocument();
    expect(screen.getByTestId("tool-text")).toBeInTheDocument();
    expect(screen.getByTestId("tool-eraser")).toBeInTheDocument();
  });

  it("calls onToolChange when switching tools", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByTestId("tool-rectangle"));
    expect(props.onToolChange).toHaveBeenCalledWith("rectangle");
  });

  it("disables undo/redo buttons when there is no history", () => {
    renderToolbar({ canUndo: false, canRedo: false });
    expect(screen.getByLabelText("Undo")).toBeDisabled();
    expect(screen.getByLabelText("Redo")).toBeDisabled();
  });

  it("enables undo/redo buttons and fires callbacks", () => {
    const props = renderToolbar({ canUndo: true, canRedo: true });
    const undoBtn = screen.getByLabelText("Undo");
    const redoBtn = screen.getByLabelText("Redo");
    expect(undoBtn).toBeEnabled();
    expect(redoBtn).toBeEnabled();
    fireEvent.click(undoBtn);
    fireEvent.click(redoBtn);
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onRedo).toHaveBeenCalledTimes(1);
  });

  it("calls onSave when Save is clicked", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByLabelText("Save"));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("changes stroke color via swatch click", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByTestId("swatch-#ef4444"));
    expect(props.onStrokeColorChange).toHaveBeenCalledWith("#ef4444");
  });
});
