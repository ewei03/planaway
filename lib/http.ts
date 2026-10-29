import { auth } from "@/auth";
import { ConflictError, ForbiddenError, NotFoundError } from "./store";

export type IdParams = { params: Promise<{ id: string }> };

export class UnauthorizedError extends Error {}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** The signed-in user, or a 401. */
export async function requireUser(): Promise<{ id: string; name: string }> {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError("Please sign in.");
  return { id: session.user.id, name: session.user.name ?? "Someone" };
}

/** Reads a JSON body, treating a missing or malformed one as {}. */
export async function body(req: Request): Promise<Record<string, unknown>> {
  const data = await req.json().catch(() => ({}));
  return data && typeof data === "object" ? data : {};
}

/** A trimmed, length-capped string field, or "" if absent. */
export function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Wraps a route handler, mapping domain errors to HTTP status codes. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
      if (err instanceof NotFoundError) return jsonError(err.message, 404);
      if (err instanceof ForbiddenError) return jsonError(err.message, 403);
      if (err instanceof ConflictError) return jsonError(err.message, 409);
      console.error(err);
      return jsonError("Internal server error", 500);
    }
  };
}
