"use client";

import * as React from "react";
import type { ToolType } from "@shared/contract";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MousePointer2,
  Pencil,
  Square,
  Circle,
  Minus,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Save,
} from "lucide-react";

const TOOLS: { value: ToolType; label: string; icon: React.ReactNode }[] = [
  { value: "select", label: "Select", icon: <MousePointer2 className="h-4 w-4" /> },
  { value: "pen", label: "Pen", icon: <Pencil className="h-4 w-4" /> },
  { value: "rectangle", label: "Rectangle", icon: <Square className="h-4 w-4" /> },
  { value: "ellipse", label: "Ellipse", icon: <Circle className="h-4 w-4" /> },
  { value: "line", label: "Line", icon: <Minus className="h-4 w-4" /> },
  { value: "text", label: "Text", icon: <Type className="h-4 w-4" /> },
  { value: "eraser", label: "Eraser", icon: <Eraser className="h-4 w-4" /> },
];

const SWATCHES = ["#0f172a", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ffffff"];

export interface ToolbarProps {
  tool: ToolType;
  onToolChange: (tool: ToolType) => void;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  fillColor: string | null;
  onFillColorChange: (color: string | null) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  saving?: boolean;
}

export function Toolbar({
  tool,
  onToolChange,
  strokeColor,
  onStrokeColorChange,
  fillColor,
  onFillColorChange,
  strokeWidth,
  onStrokeWidthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  saving,
}: ToolbarProps) {
  return (
    <div
      data-testid="toolbar"
      className="flex flex-wrap items-center gap-3 border-b bg-background px-3 py-2"
    >
      <TooltipProvider>
        <ToggleGroup
          type="single"
          value={tool}
          onValueChange={(v) => v && onToolChange(v as ToolType)}
          aria-label="Tool"
        >
          {TOOLS.map((t) => (
            <Tooltip key={t.value}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={t.value} aria-label={t.label} data-testid={`tool-${t.value}`}>
                  {t.icon}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{t.label}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </TooltipProvider>

      <div className="flex items-center gap-1" aria-label="Stroke color">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`color ${c}`}
            data-testid={`swatch-${c}`}
            onClick={() => onStrokeColorChange(c)}
            className="h-5 w-5 rounded-full border"
            style={{ backgroundColor: c, outline: strokeColor === c ? "2px solid #3b82f6" : undefined }}
          />
        ))}
        <input
          type="color"
          aria-label="Custom stroke color"
          value={strokeColor}
          onChange={(e) => onStrokeColorChange(e.target.value)}
          className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
        />
      </div>

      <div className="flex items-center gap-2" aria-label="Fill color">
        <label className="text-xs text-muted-foreground">Fill</label>
        <input
          type="checkbox"
          checked={fillColor !== null}
          onChange={(e) => onFillColorChange(e.target.checked ? strokeColor : null)}
          aria-label="Toggle fill"
        />
        {fillColor !== null && (
          <input
            type="color"
            value={fillColor}
            onChange={(e) => onFillColorChange(e.target.value)}
            aria-label="Fill color"
            className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
          />
        )}
      </div>

      <div className="flex w-32 items-center gap-2">
        <label className="text-xs text-muted-foreground">Width</label>
        <Slider
          min={1}
          max={24}
          step={1}
          value={[strokeWidth]}
          onValueChange={(v) => onStrokeWidthChange(v[0] ?? strokeWidth)}
          aria-label="Stroke width"
        />
        <span className="w-4 text-right text-xs tabular-nums">{strokeWidth}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="icon" disabled={!canUndo} onClick={onUndo} aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" disabled={!canRedo} onClick={onRedo} aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button variant="default" size="sm" onClick={onSave} disabled={saving} aria-label="Save">
          <Save className="mr-1.5 h-4 w-4" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
