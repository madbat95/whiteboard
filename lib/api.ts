import type {
  CreateBoardRequest,
  CreateBoardResponse,
  GetBoardResponse,
  ListBoardsResponse,
  SaveBoardSnapshotRequest,
  SaveBoardSnapshotResponse,
  DeleteBoardResponse,
  RoomId,
} from "@shared/contract";

/**
 * REST client for the backend gateway. Per contract §4, calls go directly
 * cross-origin to NEXT_PUBLIC_API_URL — NOT proxied through Next.js route
 * handlers.
 */

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    // Fail loudly in dev rather than silently hitting a relative path that
    // would route into Next.js itself.
    console.warn(
      "NEXT_PUBLIC_API_URL is not set — REST calls will fail. See .env.example."
    );
  }
  return base ?? "";
}

async function request<T>(
  path: string,
  token: string | undefined,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const boardsApi = {
  create(token: string, body: CreateBoardRequest): Promise<CreateBoardResponse> {
    return request<CreateBoardResponse>("/api/boards", token, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  list(token: string): Promise<ListBoardsResponse> {
    return request<ListBoardsResponse>("/api/boards", token, { method: "GET" });
  },

  get(token: string, roomId: RoomId): Promise<GetBoardResponse> {
    return request<GetBoardResponse>(`/api/boards/${roomId}`, token, {
      method: "GET",
    });
  },

  save(
    token: string,
    roomId: RoomId,
    body: SaveBoardSnapshotRequest
  ): Promise<SaveBoardSnapshotResponse> {
    return request<SaveBoardSnapshotResponse>(`/api/boards/${roomId}`, token, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  remove(token: string, roomId: RoomId): Promise<DeleteBoardResponse> {
    return request<DeleteBoardResponse>(`/api/boards/${roomId}`, token, {
      method: "DELETE",
    });
  },

  /** Best-effort beacon on page unload — fire and forget, no auth header
   * possible via sendBeacon, so this is only used when a token can be
   * embedded in a small JSON blob the backend accepts unauthenticated-ish
   * for this one path, OR (more likely) skipped in favor of a final fetch
   * with keepalive. We use fetch keepalive here since sendBeacon can't set
   * custom headers (needed for Bearer auth). */
  saveBeacon(token: string, roomId: RoomId, body: SaveBoardSnapshotRequest): void {
    try {
      fetch(`${apiBase()}/api/boards/${roomId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // best-effort — ignore
    }
  },
};
