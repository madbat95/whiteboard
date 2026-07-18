# Task List — Collaborative Whiteboard v1

Legend: `[ ]` not started · `[~]` blocked · `[x]` done

## 0. Contract (hard dependency — blocks everything below)

- [x] **T0. Define & approve `/shared/contract.ts`**
  - Owner: main thread (done by orchestrator, not a subagent)
  - Output: `/shared/contract.ts` — WS event names, payload shapes, REST routes
  - **Status: APPROVED.** Open questions in §4 resolved (rate limiting, REST transport/CORS, checkpoint cadence, conflict resolution, auth transport).
  - Sections 1 and 2 tasks are now READY.

---

## 1. backend-agent — owns `/server`

All tasks below are `[ ]` NOT READY until T0 is `[x]`.

- [ ] B1. NestJS project scaffold (`/server`)
- [ ] B2. Postgres schema: `users`, `boards`, `board_snapshots` (+ migration setup)
- [ ] B3. JWT auth guard (verifies token issued by NextAuth, shared secret/JWKS — depends on contract §4 open question)
- [ ] B4. REST: `POST /api/boards`, `GET /api/boards`, `GET /api/boards/:roomId`, `PATCH /api/boards/:roomId`, `DELETE /api/boards/:roomId` (per contract §3, exact shapes)
- [ ] B5. WebSocket gateway: connection auth, `room:join`/`room:leave` (per contract §2)
- [ ] B6. Room/session management (in-memory + Redis-backed roster)
- [ ] B7. Redis pub/sub: socket.io Redis adapter for multi-instance scaling
- [ ] B8. Presence: `presence:join`/`presence:leave`/`cursor:update` broadcast, Redis TTL keys for cursor state
- [ ] B9. Object sync: `object:create/update/delete` handlers, seq counter per room, rebroadcast as `object:created/updated/deleted`
- [ ] B10. Undo/redo relay: `history:undo`/`history:redo` → `history:undone`/`history:redone`
- [ ] B11. Snapshot persistence: periodic + manual checkpoint into `board_snapshots`, resync flow (`room:resync-required`)
- [ ] B12. Backend tests (unit: gateway handlers, room service; integration: REST CRUD) — run before reporting done

**Dependencies:** B3 depends on resolving contract §4 auth-transport question. B7/B8 depend on B6.

---

## 2. frontend-agent — owns `/app`, `/components`, `/hooks`

All tasks below are `[ ]` NOT READY until T0 is `[x]`. Additionally:
**F5–F10 (live sync) depend on backend gateway (B5, B9) existing/deployed to a reachable dev endpoint** — frontend-agent should build against the contract types and mock/stub the socket layer until backend confirms gateway is up, then integrate.

- [ ] F1. Next.js app scaffold, Tailwind + shadcn/ui setup
- [ ] F2. Auth flow (NextAuth), room create/join-via-link pages
- [ ] F3. Canvas surface (Canvas API or fabric.js) — freehand draw, shapes, text tool
- [ ] F4. Toolbar (shadcn-based): tool select, color, stroke width
- [ ] F5. `hooks/useWebSocket.ts` — socket.io client wrapper, typed against `/shared/contract.ts` (**depends on B5**)
- [ ] F6. `hooks/useCanvasSync.ts` — emits `object:create/update/delete`, applies incoming `object:created/updated/deleted` (**depends on B9**)
- [ ] F7. Cursor tracking + rendering — emits `cursor:move`, renders `cursor:update` (**depends on B8**)
- [ ] F8. Presence UI — avatar stack from `presence:join/leave` + `room:state.users` (**depends on B8**)
- [ ] F9. Undo/redo (local history stack + emits `history:undo/redo`, applies `history:undone/redone`) (**depends on B10**)
- [ ] F10. Board load/reload — `GET /api/boards/:roomId` on mount, manual save via `PATCH` (**depends on B4, B11**)
- [ ] F11. Frontend tests (component tests for canvas/toolbar, hook tests with mocked socket) — run before reporting done

---

## 3. Integration (main thread, after both agents report done)

- [x] I1. Review both diffs against `/shared/contract.ts` for drift — no drift found
- [x] I2. Confirm event names/payloads match exactly on both sides — all 15 WS events + 5 REST routes verified via grep on both codebases
- [x] I3. Resolve any "stopped and reported back" items from either agent — neither agent stopped; backend flagged one underspecified item (board sharing/ACL, not in contract) and made a reasonable owner-only judgment call, documented in code
- [ ] I4. Hand off to user for local end-to-end test — BLOCKED: no Node.js/npm on this machine, neither agent could run `npm install`/tests, and no live integration test was possible. User must run both test suites locally.
