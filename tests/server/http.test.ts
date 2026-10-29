import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

import { UnauthorizedError, body, handler, requireUser, str } from "@/lib/http";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/store";

const post = (raw: string) => new Request("http://test/", { method: "POST", body: raw });

describe("body", () => {
  it("parses a JSON object", async () => {
    expect(await body(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it.each([["not json"], [""], ["null"], ['"a string"'], ["42"]])("treats %j as {}", async (raw) => {
    expect(await body(post(raw))).toEqual({});
  });
});

describe("str", () => {
  it("trims and caps strings", () => {
    expect(str("  hello  ", 10)).toBe("hello");
    expect(str("abcdef", 3)).toBe("abc");
  });

  it.each([[undefined], [null], [42], [{}], [["a"]]])("returns '' for %j", (v) => {
    expect(str(v, 10)).toBe("");
  });
});

describe("requireUser", () => {
  beforeEach(() => authMock.mockReset());

  it("returns the session user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", name: "Maya" } });
    expect(await requireUser()).toEqual({ id: "u1", name: "Maya" });
  });

  it("defaults a missing name", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    expect((await requireUser()).name).toBe("Someone");
  });

  it("throws UnauthorizedError without a session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("handler", () => {
  it.each([
    [new UnauthorizedError("Please sign in."), 401],
    [new NotFoundError("Trip not found"), 404],
    [new ForbiddenError("nope"), 403],
    [new ConflictError("busy"), 409],
  ])("maps %s to %i", async (err, status) => {
    const res = await handler(async () => {
      throw err;
    })();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: err.message });
  });

  it("hides unexpected errors behind a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handler(async () => {
      throw new Error("secret database detail");
    })();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });

  it("passes arguments and successful responses through", async () => {
    const res = await handler(async (n: number) => Response.json({ n }))(7);
    expect(await res.json()).toEqual({ n: 7 });
  });
});
