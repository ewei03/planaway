import { fireEvent, render, screen } from "@testing-library/react";
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
  for (const [label, value] of Object.entries(fields)) {
    const input = screen.getByLabelText(label);
    // Date inputs take a whole value, not keystrokes.
    if (input.getAttribute("type") === "date") fireEvent.change(input, { target: { value } });
    else await userEvent.type(input, value);
  }
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

  it("registers, asks for the emailed code, then signs in", async () => {
    const fetch = mockFetch(() => Response.json({ ok: true, verify: true }, { status: 201 }));
    signInMock.mockResolvedValue({ ok: true });
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("minLength", "8");
    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(fetch.mock.calls[0][0]).toBe("/api/register");
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
      name: "Maya",
      email: "maya@example.com",
      password: "secret123",
      birthDate: "1990-04-12",
    });
    // Not into the app yet: the code comes first, on the same page.
    expect(signInMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("maya@example.com")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Confirmation code"), "042917");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and sign in" }));
    expect(fetch.mock.calls[1][0]).toBe("/api/verify-email/confirm");
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ email: "maya@example.com", code: "042917" });
    expect(signInMock).toHaveBeenCalledWith("credentials", { email: "maya@example.com", password: "secret123", redirect: false });
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("signs straight in after registering when addresses aren't confirmed", async () => {
    mockFetch(() => Response.json({ ok: true, verify: false }, { status: 201 }));
    signInMock.mockResolvedValue({ ok: true });
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(signInMock).toHaveBeenCalledWith("credentials", { email: "maya@example.com", password: "secret123", redirect: false });
    expect(assign).toHaveBeenCalledWith("/");
    expect(screen.queryByRole("heading", { name: "Check your email" })).toBeNull();
  });

  it("shows a wrong code, and sends a new one", async () => {
    const fetch = mockFetch((url) =>
      url === "/api/verify-email/confirm" ? Response.json({ error: "That code isn't right." }, { status: 400 }) : Response.json({ ok: true, verify: true }, { status: 201 }),
    );
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByLabelText("Confirmation code"), "111111{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't right.");
    expect(signInMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    expect(fetch).toHaveBeenLastCalledWith("/api/verify-email", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "maya@example.com" }) }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sent a new code");
  });

  it("asks for a code when an unconfirmed account signs in", async () => {
    const fetch = mockFetch(() => ({ sent: true }));
    signInMock.mockResolvedValueOnce({ error: "CredentialsSignin", code: "unverified" }).mockResolvedValueOnce({ ok: true });
    render(<AuthForm callbackUrl="/trips" />);
    await fill({ Email: "maya@example.com", Password: "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(fetch.mock.calls[0][0]).toBe("/api/verify-email");
    expect(screen.queryByRole("status")).toBeNull();
    expect(assign).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Confirmation code"), "042917");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and sign in" }));
    expect(assign).toHaveBeenCalledWith("/trips");

  });

  it("goes back to signing in from the code step", async () => {
    mockFetch(() => Response.json({ ok: true, verify: true }, { status: 201 }));
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("shows registration errors from the server without signing in", async () => {
    mockFetch(() => Response.json({ error: "An account with that email already exists." }, { status: 409 }));
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("won't register when the passwords don't match", async () => {
    const fetch = mockFetch(() => Response.json({ ok: true, verify: true }, { status: 201 }));
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret124" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The passwords don't match.");
    expect(fetch).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("asks for the password only once when signing in", () => {
    render(<AuthForm callbackUrl="/" />);
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
  });

  it("starts each view empty: nothing typed or shown carries over", async () => {
    mockFetch(() => Response.json({ error: "An account with that email already exists." }, { status: 409 }));
    render(<AuthForm callbackUrl="/" />);
    await fill({ Email: "a@b.co", Password: "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    for (const label of ["Name", "Date of birth", "Email", "Password", "Confirm password"]) expect(screen.getByLabelText(label)).toHaveValue("");

    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();

    // And back again: the sign-up details are gone too.
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    for (const label of ["Name", "Date of birth", "Email", "Password", "Confirm password"]) expect(screen.getByLabelText(label)).toHaveValue("");
  });

  it("starts sign-in empty after backing out of the code step", async () => {
    mockFetch(() => Response.json({ ok: true, verify: true }, { status: 201 }));
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill({ Name: "Maya", "Date of birth": "1990-04-12", Email: "maya@example.com", Password: "secret123", "Confirm password": "secret123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByLabelText("Confirmation code"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveValue("");
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

  it("links to resetting a password when signing in", () => {
    render(<AuthForm callbackUrl="/" />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  });

  it("points to the terms and privacy policy at sign-up", async () => {
    render(<AuthForm callbackUrl="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
  });

  it("says when sign-in is paused after too many wrong passwords", async () => {
    signInMock.mockResolvedValue({ error: "CredentialsSignin", code: "too_many_tries" });
    render(<AuthForm callbackUrl="/" />);
    await fill({ Email: "a@b.co", Password: "wrong one" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many wrong passwords. Wait 15 minutes");
  });
});
