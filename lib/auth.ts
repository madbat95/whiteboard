import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

/**
 * NextAuth is configured with a Credentials provider (simplest working
 * provider for a portfolio project — swap for a real OAuth provider later
 * without touching the rest of the app, since everything downstream only
 * depends on the session shape / JWT contents).
 *
 * IMPORTANT: contract §4 says the backend verifies the same JWT (HS256,
 * shared secret via NEXTAUTH_SECRET / JWT_SECRET) that's sent as
 * `Authorization: Bearer <token>` on REST calls and `auth: { token }` on
 * the socket.io handshake. NextAuth's *default* session token is an
 * encrypted JWE, which a plain `jsonwebtoken.verify` on the backend cannot
 * read. To match the contract exactly we override `jwt.encode`/`decode`
 * to produce/consume a standard signed (not encrypted) HS256 JWT instead
 * of NextAuth's default JWE, so /server can verify it with the shared
 * secret using a standard JWT library.
 */

const secret = process.env.NEXTAUTH_SECRET ?? "dev-shared-secret-change-me";

export const authOptions: AuthOptions = {
  secret,
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Guest",
      credentials: {
        name: { label: "Display name", type: "text" },
      },
      async authorize(credentials) {
        const name = credentials?.name?.trim();
        if (!name) return null;
        // No persistent user store for v1 — each sign-in mints a fresh
        // user id. Good enough for a portfolio demo; swap for a real
        // user lookup if a `users` table gets wired in.
        return {
          id: randomUUID(),
          name,
          email: null,
          image: null,
        };
      },
    }),
  ],
  jwt: {
    async encode({ token }) {
      return jwt.sign(
        {
          sub: token?.sub,
          name: token?.name,
          picture: token?.picture ?? null,
        },
        secret,
        { algorithm: "HS256", expiresIn: "7d" }
      );
    },
    async decode({ token }) {
      if (!token) return null;
      try {
        const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
        if (typeof decoded === "string") return null;
        return decoded as any;
      } catch {
        return null;
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
        token.picture = (user as any).image ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        session.user.name = token.name ?? session.user.name;
      }
      // Expose the raw HS256 JWT to the client so it can be attached to
      // WS handshake `auth: { token }` and REST `Authorization` header.
      (session as any).accessToken = jwt.sign(
        { sub: token.sub, name: token.name, picture: token.picture ?? null },
        secret,
        { algorithm: "HS256", expiresIn: "7d" }
      );
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};
