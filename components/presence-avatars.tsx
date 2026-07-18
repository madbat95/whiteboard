"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { UserSummary } from "@shared/contract";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fallbackColor } from "@/lib/utils";

export interface PresenceAvatarsProps {
  users: UserSummary[];
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Avatar stack sourced from room:state.users + presence:join/leave, with
 * Framer Motion join/leave transitions. */
export function PresenceAvatars({ users }: PresenceAvatarsProps) {
  return (
    <div className="flex items-center -space-x-2" data-testid="presence-avatars">
      <AnimatePresence initial={false}>
        {users.map((user) => (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, scale: 0.6, x: -8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18 }}
            data-testid={`avatar-${user.id}`}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar
                  className="border-2"
                  style={{ borderColor: user.color ?? fallbackColor(user.id) }}
                >
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                  <AvatarFallback style={{ backgroundColor: user.color ?? fallbackColor(user.id) }}>
                    {initials(user.name || "?")}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent>{user.name}</TooltipContent>
            </Tooltip>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
