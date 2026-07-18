import { vi } from "vitest";

/** Minimal fake socket.io Socket: records listeners and lets tests fire
 * server->client events synchronously via __trigger. */
export function createMockSocket() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};

  const socket = {
    connected: false,
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      (listeners[event] ??= []).push(cb);
      return socket;
    }),
    off: vi.fn((event: string, cb?: (...args: any[]) => void) => {
      if (!listeners[event]) return socket;
      if (!cb) {
        listeners[event] = [];
      } else {
        listeners[event] = listeners[event].filter((fn) => fn !== cb);
      }
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    __trigger(event: string, ...args: any[]) {
      (listeners[event] ?? []).forEach((fn) => fn(...args));
    },
    __listenerCount(event: string) {
      return (listeners[event] ?? []).length;
    },
  };

  return socket;
}

export type MockSocket = ReturnType<typeof createMockSocket>;
