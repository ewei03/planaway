import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContactForm } from "@/components/ContactForm";
import { ForgotPasswordForm, ResetPasswordForm } from "@/components/PasswordReset";
import { VerifyEmailPrompt } from "@/components/VerifyEmail";
import { mockFetch } from "./fixtures";

let assign: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign, reload });
  return () => vi.unstubAllGlobals();
});

const bodyOf = (fetch: ReturnType<typeof mockFetch>, i = 0) => JSON.parse(fetch.mock.calls[i][1]!.body as string);

describe("VerifyEmailPrompt", () => {
  it("says where the link went, and sends it again", async () => {
    const fetch = mockFetch(() => ({ sent: true }));
    render(<VerifyEmailPrompt email="robin@example.com" onOpenSidebar={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Confirm your email" })).toBeInTheDocument();
    expect(screen.getByText("robin@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change it in Settings" })).toHaveAttribute("href", "/settings");
    await userEvent.click(screen.getByRole("button", { name: "Send the email again" }));
    expect(fetch).toHaveBeenCalledWith("/api/verify-email", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sent. Check your inbox");
  });

  it("shows why it couldn't send", async () => {
    mockFetch(() => Response.json({ error: "We've sent a few already." }, { status: 429 }));
    render(<VerifyEmailPrompt email="robin@example.com" onOpenSidebar={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send the email again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We've sent a few already.");
  });

  it("opens up the app once the address is confirmed in another tab", async () => {
    mockFetch(() => ({ emailVerified: true }));
    render(<VerifyEmailPrompt email="robin@example.com" onOpenSidebar={vi.fn()} />);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  });
});

describe("ForgotPasswordForm", () => {
  it("asks for a link, then says to check the inbox", async () => {
    const fetch = mockFetch(() => ({ ok: true }));
    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText("Email"), "robin@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(bodyOf(fetch)).toEqual({ email: "robin@example.com" });
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("If there’s a PlanAway account for robin@example.com");
  });
});

describe("ResetPasswordForm", () => {
  it("sets the new password and sends you to sign in", async () => {
    const fetch = mockFetch(() => ({ ok: true }));
    render(<ResetPasswordForm token="tok" />);
    await userEvent.type(screen.getByLabelText("New password"), "a brand new password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a brand new password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(bodyOf(fetch)).toEqual({ token: "tok", password: "a brand new password" });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/login?reset=1"));
  });

  it("catches a mistyped confirmation before sending", async () => {
    const fetch = mockFetch();
    render(<ResetPasswordForm token="tok" />);
    await userEvent.type(screen.getByLabelText("New password"), "a brand new password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a brand new passwrod");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The two passwords don't match.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers a new link when this one has expired", async () => {
    mockFetch(() => Response.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 400 }));
    render(<ResetPasswordForm token="old" />);
    await userEvent.type(screen.getByLabelText("New password"), "a brand new password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a brand new password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/forgot-password");
  });
});

describe("ContactForm", () => {
  const topics = ["Something isn't working", "Account help", "Something else"];

  it("starts with a signed-in person's details, and sends the message", async () => {
    const fetch = mockFetch(() => ({ ok: true }));
    render(<ContactForm topics={topics} initial={{ name: "Maya", email: "maya@example.com" }} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Maya");
    expect(screen.getByLabelText("Email")).toHaveValue("maya@example.com");
    expect(screen.getByText(/what you expected, and what happened instead/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Topic"), "Account help");
    await userEvent.type(screen.getByLabelText("Message"), "I can't change my photo.");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(bodyOf(fetch)).toEqual({ name: "Maya", email: "maya@example.com", topic: "Account help", message: "I can't change my photo.", website: "" });
    expect(await screen.findByRole("status")).toHaveTextContent("We’ll reply to maya@example.com");
  });

  it("hides the field for bots from people and the keyboard", () => {
    render(<ContactForm topics={topics} initial={{ name: "", email: "" }} />);
    const trap = document.getElementById("contact-website")!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows why it couldn't send", async () => {
    mockFetch(() => Response.json({ error: "Tell us a little more in your message." }, { status: 400 }));
    render(<ContactForm topics={topics} initial={{ name: "Sam", email: "sam@example.com" }} />);
    await userEvent.type(screen.getByLabelText("Message"), "Hello there friends");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tell us a little more in your message.");
  });
});
