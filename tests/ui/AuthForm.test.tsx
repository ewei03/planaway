import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "./fixtures";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: signInMock }));

import { AuthForm } from "@/components/AuthForm";

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  signInMock.mockReset();
  assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  return () => vi.unstubAllGlobals();
});

async function fill(fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) await userEvent.type(screen.getByLabelText(label), value);
}

describe("AuthForm", () => {
  it("signs in and navigates to the callback URL", async () => {
    signInMock.mockResolvedValue({ ok: true, error: undefined });
    render(<AuthForm callbackUrl="/invite/abc" />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    await fill({ Email: "maya@example.com", Password: "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signInMock).toHaveBeenCalledWith("credentials", { email: "maya@example.com", password: "secret123", redirect: false });
    expect(assign).toHaveBeenCalledWith("/invite/abc");
  });

  it("shows an error for wrong credentials", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
    render(<AuthForm callbackUrl="/" />);
    await fill({ Email: "maya@example.com", Password: "wrong" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("registers, then signs in", async () => {
    const fetch = mockFetch(() => Response.json({ ok: true }, { status: 201 }));
    signInMock.mockResolvedValue({ ok: true });
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("minLength", "8");
    await fill({ Name: "Maya", Email: "maya@example.com", Password: "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(fetch.mock.calls[0][0]).toBe("/api/register");
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ name: "Maya", email: "maya@example.com", password: "secret123" });
    expect(signInMock).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("shows registration errors from the server without signing in", async () => {
    mockFetch(() => Response.json({ error: "An account with that email already exists." }, { status: 409 }));
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill({ Name: "Maya", Email: "maya@example.com", Password: "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("clears the error when switching modes", async () => {
    signInMock.mockResolvedValue({ error: "x" });
    render(<AuthForm callbackUrl="/" />);
    await fill({ Email: "a@b.co", Password: "x" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
