"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { UserSummary } from "@shared/contract";
import type { RemoteCursor } from "@/hooks/useCursorTracking";
import { fallbackColor } from "@/lib/utils";

export interface CursorLayerProps {
  cursors: Record<string, RemoteCursor>;
  users: UserSummary[];
}

/** Renders other users' cursors, colored per contract's UserSummary.color. */
export function CursorLayer({ cursors, users }: CursorLayerProps) {
  const userById = new Map(users.map((u) => [u.id, u]));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="cursor-layer">
      <AnimatePresence>
        {Object.values(cursors).map((cursor) => {
          const user = userById.get(cursor.userId);
          const color = user?.color ?? fallbackColor(cursor.userId);
          return (
            <motion.div
              key={cursor.userId}
              className="absolute flex items-center gap-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: cursor.x, y: cursor.y }}
              exit={{ opacity: 0 }}
              transition={{ type: "tween", duration: 0.08 }}
              data-testid={`cursor-${cursor.userId}`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 1L15 7L8 8.5L6 15L1 1Z" fill={color} stroke="white" strokeWidth="1" />
              </svg>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] text-white shadow"
                style={{ backgroundColor: color }}
              >
                {user?.name ?? "Guest"}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
