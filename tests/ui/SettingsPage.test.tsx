import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "@/components/SettingsPage";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/settings";
import type { Profile } from "@/lib/store";
import { mockFetch } from "./fixtures";

const profile = (settings: Partial<UserSettings> = {}): Profile => ({
  id: "u-me",
  name: "Maya",
  email: "maya@example.com",
  avatarUrl: null,
  settings: { ...DEFAULT_SETTINGS, ...settings },
});

const OAKLAND = { kind: "city", label: "Oakland", detail: "California, United States", value: "Oakland, California, United States" };

/** Answers each settings call the way the server would, echoing what was sent. */
function server() {
  return mockFetch((url, init) => {
    const sent = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("/api/places/suggest")) return { suggestions: [OAKLAND] };
    if (url === "/api/settings/preferences") return sent;
    if (url === "/api/settings") return { ...profile(), ...sent, password: undefined };
    if (url === "/api/settings/avatar") return init?.method === "DELETE" ? null : { avatarUrl: "/api/avatars/u-me?v=1" };
    return null;
  });
}

const sentTo = (fetch: ReturnType<typeof server>, url: string) =>
  fetch.mock.calls.filter(([u]) => String(u) === url).map(([, init]) => JSON.parse(String(init?.body)));

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("SettingsPage", () => {
  it("applies and saves the theme straight away", async () => {
    const fetch = server();
    render(<SettingsPage profile={profile()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await vi.waitFor(() => expect(sentTo(fetch, "/api/settings/preferences")).toHaveLength(1));
    expect(sentTo(fetch, "/api/settings/preferences")[0].theme).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "Match my device" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("asks for the password only when the email changes", async () => {
    const fetch = server();
    render(<SettingsPage profile={profile()} />);
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(screen.queryByLabelText("Current password")).toBeNull();

    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.type(screen.getByLabelText("Email"), "maya@new.example");
    await userEvent.type(screen.getByLabelText("Current password"), "secret password");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Profile saved.");
    expect(sentTo(fetch, "/api/settings")[0]).toEqual({ name: "Maya", email: "maya@new.example", password: "secret password" });
  });

  it("saves only the name when the email is unchanged", async () => {
    const fetch = server();
    render(<SettingsPage profile={profile()} />);
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Maya Lee");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Profile saved.");
    expect(sentTo(fetch, "/api/settings")[0]).toEqual({ name: "Maya Lee" });
  });

  it("saves trip defaults without undoing the theme picked a moment ago", async () => {
    const fetch = server();
    render(<SettingsPage profile={profile()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await vi.waitFor(() => expect(sentTo(fetch, "/api/settings/preferences")).toHaveLength(1));

    await userEvent.type(screen.getByLabelText("Starting point"), "Oakland");
    await userEvent.click(await screen.findByRole("option", { name: /^Oakland/ }));
    await userEvent.selectOptions(screen.getByLabelText("Usually travel by"), "drive");
    await userEvent.type(screen.getByLabelText("Travelers"), "3");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "CAD");
    await userEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    await screen.findByText("Defaults saved.");

    const last = sentTo(fetch, "/api/settings/preferences").at(-1);
    expect(last.theme).toBe("dark");
    expect(last.defaults).toEqual({ currency: "CAD", origin: "Oakland, California, United States", travelMode: "drive", travelers: 3, pace: null });
  });

  it("won't save a starting point that wasn't picked from the suggestions", async () => {
    const fetch = server();
    render(<SettingsPage profile={profile()} />);
    const origin = screen.getByLabelText("Starting point");
    await userEvent.type(origin, "Oakland");
    await userEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    expect(await screen.findByText("Choose a place from the list, or clear the field.")).toBeInTheDocument();
    expect(origin).toHaveAttribute("aria-invalid", "true");
    expect(origin).toHaveFocus();
    expect(sentTo(fetch, "/api/settings/preferences")).toHaveLength(0);

    // Picking one clears the error, and so does emptying the field.
    await userEvent.click(await screen.findByRole("option", { name: /^Oakland/ }));
    expect(screen.queryByText("Choose a place from the list, or clear the field.")).toBeNull();
    await userEvent.clear(origin);
    await userEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    await screen.findByText("Defaults saved.");
    expect(sentTo(fetch, "/api/settings/preferences")[0].defaults.origin).toBeNull();
  });

  it("keeps an already saved starting point without picking it again", async () => {
    const fetch = server();
    render(<SettingsPage profile={profile({ defaults: { ...DEFAULT_SETTINGS.defaults, origin: "Lisbon, Portugal" } })} />);
    await userEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    await screen.findByText("Defaults saved.");
    expect(sentTo(fetch, "/api/settings/preferences")[0].defaults.origin).toBe("Lisbon, Portugal");
  });

  it("keeps a theme that's still saving when defaults are saved right after", async () => {
    let releaseTheme!: () => void;
    const fetch = mockFetch((url, init) => {
      const sent = JSON.parse(String(init?.body));
      // Hold the theme save open until after Save defaults has been sent.
      if (sent.theme === "dark" && !sent.defaults.travelers) return new Promise<Response>((r) => (releaseTheme = () => r(Response.json(sent))));
      return sent;
    });
    render(<SettingsPage profile={profile()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.type(screen.getByLabelText("Travelers"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    await screen.findByText("Defaults saved.");
    releaseTheme();
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.at(-1)).toMatchObject({ theme: "dark", defaults: { travelers: 4 } });
  });

  it("saves a changed activity color shortly after, and can reset it", async () => {
    const fetch = server();
    render(<SettingsPage profile={profile()} />);
    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "#ff0000" } });
    await vi.waitFor(() => expect(sentTo(fetch, "/api/settings/preferences")).toHaveLength(1), { timeout: 2000 });
    expect(sentTo(fetch, "/api/settings/preferences")[0].activityColors).toEqual({ food: "#ff0000" });

    await userEvent.click(screen.getByRole("button", { name: "Reset Food color" }));
    await vi.waitFor(() => expect(sentTo(fetch, "/api/settings/preferences")).toHaveLength(2), { timeout: 2000 });
    expect(sentTo(fetch, "/api/settings/preferences")[1].activityColors).toEqual({});
  });

  it("removes the photo", async () => {
    server();
    render(<SettingsPage profile={{ ...profile(), avatarUrl: "/api/avatars/u-me?v=1" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("Photo removed.");
    expect(screen.getByText("Upload photo")).toBeInTheDocument();
  });
});
