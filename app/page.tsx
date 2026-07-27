"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { boardsApi } from "@/lib/api";

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [boardName, setBoardName] = useState("My Board");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authed = status === "authenticated";

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    await signIn("credentials", { name: displayName.trim(), redirect: false });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const board = await boardsApi.create(session.accessToken, { name: boardName || "Untitled" });
      router.push(`/board/${board.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Whiteboard</h1>
        <p className="text-sm text-muted-foreground">
          Real-time collaborative whiteboard.
        </p>
        {authed && session?.user?.name && (
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as <span className="font-medium">{session.user.name}</span>{" "}
            <button type="button" className="underline" onClick={() => signOut()}>
              Not you?
            </button>
          </p>
        )}
      </div>

      {!authed ? (
        <form onSubmit={handleSignIn} className="flex flex-col gap-3 rounded-lg border p-4">
          <Label htmlFor="displayName">Your name</Label>
          <Input
            id="displayName"
            placeholder="e.g. Ada"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button type="submit" disabled={!displayName.trim()}>
            Continue
          </Button>
        </form>
      ) : (
        <>
          <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border p-4">
            <Label htmlFor="boardName">New board name</Label>
            <Input
              id="boardName"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create board"}
            </Button>
          </form>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </main>
  );
}
