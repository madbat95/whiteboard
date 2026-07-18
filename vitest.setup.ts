import "@testing-library/jest-dom/vitest";

// jsdom has no PointerEvent constructor, so fireEvent.pointerDown/Move/Up
// build a plain Event rather than a MouseEvent subclass. React's synthetic
// event system only extracts clientX/clientY when nativeEvent is a real
// MouseEvent, so without this polyfill those fields silently come through
// as undefined in every pointer handler. See jsdom/jsdom#2527.
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    public pointerType: string;
    public isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom doesn't implement ResizeObserver — CanvasBoard uses it to size the canvas.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = global.ResizeObserver ?? ResizeObserverMock;

// jsdom's canvas getContext returns null unless a canvas backend is installed;
// stub a minimal 2D context so render code paths don't throw during tests.
if (typeof HTMLCanvasElement !== "undefined") {
  // @ts-expect-error - partial mock is fine for rendering smoke tests
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      ellipse: () => {},
      fillText: () => {},
      setLineDash: () => {},
      measureText: () => ({ width: 0 }),
    };
  };
}
