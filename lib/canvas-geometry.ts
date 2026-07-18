import type { BoardObject, Point } from "@shared/contract";

/** Rough text width estimate (avoids needing a live canvas context for hit-testing). */
export function estimateTextWidth(content: string, fontSize: number): number {
  return content.length * fontSize * 0.6;
}

export function boundsOf(obj: BoardObject): { x: number; y: number; width: number; height: number } {
  switch (obj.type) {
    case "path": {
      const xs = obj.points.map((p) => p.x);
      const ys = obj.points.map((p) => p.y);
      const minX = Math.min(...xs, 0);
      const minY = Math.min(...ys, 0);
      const maxX = Math.max(...xs, 0);
      const maxY = Math.max(...ys, 0);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case "rectangle":
    case "ellipse":
      return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    case "line":
      return {
        x: Math.min(obj.x1, obj.x2),
        y: Math.min(obj.y1, obj.y2),
        width: Math.abs(obj.x2 - obj.x1),
        height: Math.abs(obj.y2 - obj.y1),
      };
    case "text": {
      const width = estimateTextWidth(obj.content, obj.fontSize);
      return { x: obj.x, y: obj.y - obj.fontSize, width, height: obj.fontSize * 1.3 };
    }
  }
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Hit-test a point against a board object; returns true if the point should select it. */
export function hitTest(obj: BoardObject, point: Point, tolerance = 6): boolean {
  switch (obj.type) {
    case "path": {
      for (let i = 0; i < obj.points.length - 1; i++) {
        if (distToSegment(point, obj.points[i], obj.points[i + 1]) <= tolerance + obj.strokeWidth) {
          return true;
        }
      }
      return obj.points.length === 1 && Math.hypot(point.x - obj.points[0].x, point.y - obj.points[0].y) <= tolerance;
    }
    case "rectangle": {
      const { x, y, width, height } = obj;
      if (obj.fillColor) {
        return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
      }
      // Stroke-only: check near the border.
      const withinOuter = point.x >= x - tolerance && point.x <= x + width + tolerance && point.y >= y - tolerance && point.y <= y + height + tolerance;
      const withinInner = point.x >= x + tolerance && point.x <= x + width - tolerance && point.y >= y + tolerance && point.y <= y + height - tolerance;
      return withinOuter && !withinInner;
    }
    case "ellipse": {
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      const rx = obj.width / 2 || 1;
      const ry = obj.height / 2 || 1;
      const norm = ((point.x - cx) ** 2) / (rx * rx) + ((point.y - cy) ** 2) / (ry * ry);
      if (obj.fillColor) return norm <= 1;
      const outerNorm = ((point.x - cx) ** 2) / ((rx + tolerance) ** 2) + ((point.y - cy) ** 2) / ((ry + tolerance) ** 2);
      const innerNorm = ((point.x - cx) ** 2) / (Math.max(rx - tolerance, 1) ** 2) + ((point.y - cy) ** 2) / (Math.max(ry - tolerance, 1) ** 2);
      return outerNorm <= 1 && innerNorm >= 1;
    }
    case "line":
      return distToSegment(point, { x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }) <= tolerance + obj.strokeWidth;
    case "text": {
      const b = boundsOf(obj);
      return point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height;
    }
  }
}

/** Find the top-most (last-drawn) object under a point. */
export function hitTestAll(objects: BoardObject[], point: Point): BoardObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitTest(objects[i], point)) return objects[i];
  }
  return null;
}

/** Translate an object by (dx, dy), returning only the changed fields (for a patch). */
export function translateObjectPatch(obj: BoardObject, dx: number, dy: number): Record<string, unknown> {
  switch (obj.type) {
    case "path":
      return { points: obj.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "rectangle":
    case "ellipse":
      return { x: obj.x + dx, y: obj.y + dy };
    case "line":
      return { x1: obj.x1 + dx, y1: obj.y1 + dy, x2: obj.x2 + dx, y2: obj.y2 + dy };
    case "text":
      return { x: obj.x + dx, y: obj.y + dy };
  }
}
