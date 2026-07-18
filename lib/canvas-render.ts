import type { BoardObject } from "@shared/contract";

export function drawObject(ctx: CanvasRenderingContext2D, obj: BoardObject) {
  ctx.save();
  switch (obj.type) {
    case "path": {
      if (obj.points.length === 0) break;
      ctx.strokeStyle = obj.strokeColor;
      ctx.lineWidth = obj.strokeWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(obj.points[0].x, obj.points[0].y);
      for (const p of obj.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case "rectangle": {
      ctx.strokeStyle = obj.strokeColor;
      ctx.lineWidth = obj.strokeWidth;
      if (obj.fillColor) {
        ctx.fillStyle = obj.fillColor;
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      }
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
      break;
    }
    case "ellipse": {
      ctx.strokeStyle = obj.strokeColor;
      ctx.lineWidth = obj.strokeWidth;
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(obj.width) / 2, Math.abs(obj.height) / 2, 0, 0, Math.PI * 2);
      if (obj.fillColor) {
        ctx.fillStyle = obj.fillColor;
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "line": {
      ctx.strokeStyle = obj.strokeColor;
      ctx.lineWidth = obj.strokeWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
      break;
    }
    case "text": {
      ctx.fillStyle = obj.color;
      ctx.font = `${obj.fontSize}px sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(obj.content, obj.x, obj.y);
      break;
    }
  }
  ctx.restore();
}

export function renderScene(
  canvas: HTMLCanvasElement,
  objects: BoardObject[],
  draft: BoardObject | null,
  selectedId: string | null
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

  for (const obj of objects) {
    drawObject(ctx, obj);
    if (obj.id === selectedId) {
      drawSelectionOutline(ctx, obj);
    }
  }
  if (draft) drawObject(ctx, draft);
  ctx.restore();
}

function drawSelectionOutline(ctx: CanvasRenderingContext2D, obj: BoardObject) {
  ctx.save();
  ctx.strokeStyle = "#3b82f6";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  let x = 0, y = 0, w = 0, h = 0;
  if (obj.type === "rectangle" || obj.type === "ellipse") {
    x = obj.x; y = obj.y; w = obj.width; h = obj.height;
  } else if (obj.type === "line") {
    x = Math.min(obj.x1, obj.x2); y = Math.min(obj.y1, obj.y2);
    w = Math.abs(obj.x2 - obj.x1); h = Math.abs(obj.y2 - obj.y1);
  } else if (obj.type === "path") {
    const xs = obj.points.map((p) => p.x);
    const ys = obj.points.map((p) => p.y);
    x = Math.min(...xs); y = Math.min(...ys);
    w = Math.max(...xs) - x; h = Math.max(...ys) - y;
  } else if (obj.type === "text") {
    x = obj.x; y = obj.y - obj.fontSize;
    w = obj.content.length * obj.fontSize * 0.6; h = obj.fontSize * 1.3;
  }
  ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
  ctx.restore();
}
