import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createMockSocket } from "./mocks/socket";

const mockIo = vi.fn();
vi.mock("socket.io-client", () => ({
  io: (...args: any[]) => mockIo(...args),
}));

describe("useWebSocket", () => {
  const OLD_ENV = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    mockIo.mockReset();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = OLD_ENV;
    vi.resetModules();
  });

  it("does not connect when disabled or token missing", async () => {
    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { result } = renderHook(() => useWebSocket({ token: undefined }));
    expect(result.current.status).toBe("idle");
    expect(mockIo).not.toHaveBeenCalled();
  });

  it("connects with auth token in handshake and reflects connect/disconnect status", async () => {
    const socket = createMockSocket();
    mockIo.mockReturnValue(socket);

    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { result } = renderHook(() => useWebSocket({ token: "jwt-token" }));

    expect(mockIo).toHaveBeenCalledWith(
      "http://localhost:4000",
      expect.objectContaining({ auth: { token: "jwt-token" } })
    );
    expect(result.current.status).toBe("connecting");

    act(() => {
      socket.__trigger("connect");
    });
    await waitFor(() => expect(result.current.status).toBe("connected"));

    act(() => {
      socket.__trigger("disconnect");
    });
    await waitFor(() => expect(result.current.status).toBe("disconnected"));
  });

  it("surfaces connect_error as status error with a message", async () => {
    const socket = createMockSocket();
    mockIo.mockReturnValue(socket);

    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { result } = renderHook(() => useWebSocket({ token: "jwt-token" }));

    act(() => {
      socket.__trigger("connect_error", new Error("auth failed"));
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.lastError).toBe("auth failed");
  });

  it("disconnects the socket on unmount", async () => {
    const socket = createMockSocket();
    mockIo.mockReturnValue(socket);

    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { unmount } = renderHook(() => useWebSocket({ token: "jwt-token" }));
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
