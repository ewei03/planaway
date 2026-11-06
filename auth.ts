import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { limited, record } from "@/lib/rateLimit";
import { isEmailVerified, verifyCredentials } from "@/lib/store";

/** Wrong passwords allowed per account before sign-in pauses for it, so passwords can't be guessed by trying many. */
const MAX_FAILED_SIGN_INS = 10;
const FAILED_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Sign-in is paused for this address. The same for addresses with and
 * without an account, so it doesn't tell which have one.
 */
class TooManyTries extends CredentialsSignin {
  code = "too_many_tries";
}

/**
 * The password is right, but the address isn't confirmed yet. Only said after
 * the password checks out, so it gives nothing away to someone guessing.
 */
class Unverified extends CredentialsSignin {
  code = "unverified";
}

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const key = `signin:${email.trim().toLowerCase()}`;
        if (limited(key, MAX_FAILED_SIGN_INS, FAILED_SIGN_IN_WINDOW_MS)) throw new TooManyTries();
        const user = await verifyCredentials(email, password);
        if (!user) {
          record(key, FAILED_SIGN_IN_WINDOW_MS);
          return null;
        }
        // The sign-in page asks for the emailed code, then signs in again.
        if (!(await isEmailVerified(user.id))) throw new Unverified();
        return user;
      },
    }),
  ],
  // Credentials sign-in requires JWT sessions (stored in an encrypted cookie).
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Self-hosted: trust the Host header instead of requiring AUTH_URL.
  trustHost: true,
  callbacks: {
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
