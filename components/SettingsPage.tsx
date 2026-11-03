"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ACTIVITY_CATEGORIES } from "@/lib/itinerary";
import {
  DEFAULT_ACTIVITY_COLORS,
  PACES,
  THEMES,
  type ActivityCategory,
  type Theme,
  type TripDefaults,
  type UserSettings,
} from "@/lib/settings";
import type { Profile } from "@/lib/store";
import { Avatar } from "./Avatar";
import { CurrencySelect } from "./CurrencySelect";
import { api } from "./client";
import { ArrowLeftIcon, CategoryIcon } from "./icons";
import { PlaceInput } from "./PlaceInput";
import { SiteFooter } from "./SiteFooter";

const THEME_LABELS: Record<Theme, string> = { system: "Match my device", light: "Light", dark: "Dark" };

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  food: "Food",
  sightseeing: "Sightseeing",
  activity: "Activities",
  transport: "Getting around",
  lodging: "Stays",
  shopping: "Shopping",
  nightlife: "Nightlife",
  rest: "Rest",
  other: "Other",
};

const TRAVEL_MODE_OPTIONS: [TripDefaults["travelMode"], string][] = [
  [null, "Not set"],
  ["fly", "Flying"],
  ["drive", "Driving"],
  ["train", "Train"],
  ["any", "No preference"],
];

/** Photos are cropped to a square this size before upload. */
const AVATAR_PX = 256;
/** Colors save this long after the last change, so dragging a picker doesn't send a request per step. */
const COLOR_SAVE_DELAY_MS = 600;

/** A centered square crop of the image, shrunk to AVATAR_PX, as a JPEG data: URL. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't resize images.");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shows the theme right away, before the next page load sets it from the server. */
function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

type Status = { kind: "ok" | "error"; text: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p className={`settings-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
      {status.text}
    </p>
  );
}

type SaveSettings = (patch: Partial<UserSettings>) => Promise<UserSettings>;

export function SettingsPage({ profile }: { profile: Profile }) {
  // One saver for both sections, so saving one never sends the other's stale values.
  const save = useSettingsSaver(profile.settings);
  return (
    <div className="settings-page">
      <div className="settings-inner">
        <Link className="back-link" href="/">
          <ArrowLeftIcon size={16} /> Back to trips
        </Link>
        <h1>Settings</h1>
        <ProfileSection profile={profile} />
        <AppearanceSection initial={profile.settings} save={save} />
        <DefaultsSection initial={profile.settings} save={save} />
      </div>
      <SiteFooter />
    </div>
  );
}

// ---------- Profile ----------

function ProfileSection({ profile }: { profile: Profile }) {
  const [saved, setSaved] = useState({ name: profile.name, email: profile.email });
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [password, setPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const emailChanged = email.trim().toLowerCase() !== saved.email;
  const dirty = name.trim() !== saved.name || emailChanged;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const updated = await api<Profile>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ name, ...(emailChanged ? { email, password } : {}) }),
      });
      setSaved({ name: updated.name, email: updated.email });
      setName(updated.name);
      setEmail(updated.email);
      setPassword("");
      setStatus({ kind: "ok", text: "Profile saved." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setStatus(null);
    if (!file.type.startsWith("image/")) return setStatus({ kind: "error", text: "Choose an image file." });
    setBusy(true);
    try {
      const dataUrl = await shrinkPhoto(file);
      const { avatarUrl: url } = await api<{ avatarUrl: string }>("/api/settings/avatar", {
        method: "PUT",
        body: JSON.stringify({ dataUrl }),
      });
      setAvatarUrl(url);
      setStatus({ kind: "ok", text: "Photo updated." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message || "That image couldn't be read." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePhoto = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await api("/api/settings/avatar", { method: "DELETE" });
      setAvatarUrl(null);
      setStatus({ kind: "ok", text: "Photo removed." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card settings-section" aria-labelledby="profile-heading">
      <h2 id="profile-heading">Profile</h2>
      <div className="photo-row">
        <Avatar name={name || saved.name} url={avatarUrl} className="avatar big" />
        <div className="photo-actions">
          <input
            ref={fileRef}
            id="photo-file"
            className="visually-hidden"
            type="file"
            disabled={busy}
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <label htmlFor="photo-file" className="btn">
            {avatarUrl ? "Change photo" : "Upload photo"}
          </label>
          {avatarUrl && (
            <button type="button" className="btn ghost" disabled={busy} onClick={removePhoto}>
              Remove
            </button>
          )}
        </div>
      </div>

      <form onSubmit={save}>
        <label htmlFor="settings-name">Name</label>
        <input id="settings-name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="settings-email">Email</label>
        <input id="settings-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {emailChanged && (
          <>
            <label htmlFor="settings-password">Current password</label>
            <input
              id="settings-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="muted small">You sign in with your email, so changing it takes your password.</p>
          </>
        )}
        <div className="settings-actions">
          <StatusLine status={status} />
          <button className="btn primary" type="submit" disabled={busy || !dirty}>
            Save profile
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------- Appearance ----------

/**
 * Saves the whole settings object; each section sends its part merged into
 * the latest values, including ones still being saved, so two quick saves
 * (a theme click, then Save defaults) can't undo each other.
 */
function useSettingsSaver(initial: UserSettings): SaveSettings {
  const latest = useRef(initial);
  return async (patch) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    return api<UserSettings>("/api/settings/preferences", { method: "PUT", body: JSON.stringify(next) });
  };
}

function AppearanceSection({ initial, save }: { initial: UserSettings; save: SaveSettings }) {
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [colors, setColors] = useState(initial.activityColors);
  const [status, setStatus] = useState<Status>(null);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(colorTimer.current), []);

  const persist = async (patch: Partial<UserSettings>) => {
    try {
      await save(patch);
      setStatus({ kind: "ok", text: "Saved." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    }
  };

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    persist({ theme: t });
  };

  const changeColors = (next: UserSettings["activityColors"]) => {
    setColors(next);
    clearTimeout(colorTimer.current);
    colorTimer.current = setTimeout(() => persist({ activityColors: next }), COLOR_SAVE_DELAY_MS);
  };

  const setColor = (category: ActivityCategory, color: string) => {
    const next = { ...colors };
    if (color.toLowerCase() === DEFAULT_ACTIVITY_COLORS[category]) delete next[category];
    else next[category] = color.toLowerCase();
    changeColors(next);
  };

  const resetColor = (category: ActivityCategory) => {
    const next = { ...colors };
    delete next[category];
    changeColors(next);
  };

  return (
    <section className="card settings-section" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Appearance</h2>

      <fieldset>
        <legend>Theme</legend>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <label key={t} className={theme === t ? "active" : ""}>
              <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => chooseTheme(t)} />
              {THEME_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Activity colors</legend>
        <p className="muted small">The icons on each day&rsquo;s timeline. Dark mode lightens them to keep them readable.</p>
        <ul className="color-list">
          {ACTIVITY_CATEGORIES.map((category) => {
            const color = colors[category] ?? DEFAULT_ACTIVITY_COLORS[category];
            const custom = colors[category] !== undefined;
            return (
              <li key={category}>
                <span className="act-icon" style={{ "--cat": color } as React.CSSProperties} aria-hidden="true">
                  <CategoryIcon category={category} size={17} />
                </span>
                <label htmlFor={`color-${category}`}>{CATEGORY_LABELS[category]}</label>
                <input id={`color-${category}`} type="color" value={color} onChange={(e) => setColor(category, e.target.value)} />
                <button
                  type="button"
                  className="link-btn"
                  disabled={!custom}
                  aria-label={`Reset ${CATEGORY_LABELS[category]} color`}
                  onClick={() => resetColor(category)}
                >
                  Reset
                </button>
              </li>
            );
          })}
        </ul>
        {Object.keys(colors).length > 0 && (
          <button type="button" className="btn ghost" onClick={() => changeColors({})}>
            Reset all colors
          </button>
        )}
      </fieldset>
      <StatusLine status={status} />
    </section>
  );
}

// ---------- Trip defaults ----------

function DefaultsSection({ initial, save }: { initial: UserSettings; save: SaveSettings }) {
  const [d, setD] = useState(initial.defaults);
  const [travelers, setTravelers] = useState(initial.defaults.travelers ? String(initial.defaults.travelers) : "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  /** Whether the starting point came from the suggestions (or was saved that way). Typed text alone isn't enough. */
  const [originPicked, setOriginPicked] = useState(true);
  const [originError, setOriginError] = useState(false);
  const set = <K extends keyof TripDefaults>(key: K, value: TripDefaults[K]) => setD((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (d.origin && !originPicked) {
      setOriginError(true);
      setStatus(null);
      document.getElementById("d-origin")?.focus();
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const n = Number(travelers);
      const saved = await save({ defaults: { ...d, travelers: travelers && n >= 1 ? Math.round(n) : null } });
      setD(saved.defaults);
      setTravelers(saved.defaults.travelers ? String(saved.defaults.travelers) : "");
      setStatus({ kind: "ok", text: "Defaults saved." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card settings-section" aria-labelledby="defaults-heading">
      <h2 id="defaults-heading">Trip defaults</h2>
      <p className="muted small">
        Specify default values so you don&rsquo;t have to mention them in a new trip request.
      </p>
      <form onSubmit={submit}>
        <div className="grid">
          <div>
            <label htmlFor="d-origin">Starting point</label>
            <PlaceInput
              id="d-origin"
              placeholder="An airport, city, or address, e.g. SFO"
              maxLength={120}
              value={d.origin ?? ""}
              onChange={(v, picked) => {
                set("origin", v || null);
                setOriginPicked(picked);
                if (picked || !v) setOriginError(false);
              }}
              invalid={originError}
              describedBy={originError ? "d-origin-error" : undefined}
            />
            {originError && (
              <p id="d-origin-error" className="field-error" role="alert">
                Choose a place from the list, or clear the field.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="d-mode">Usually travel by</label>
            <select
              id="d-mode"
              value={d.travelMode ?? ""}
              onChange={(e) => set("travelMode", (e.target.value || null) as TripDefaults["travelMode"])}
            >
              {TRAVEL_MODE_OPTIONS.map(([value, label]) => (
                <option key={label} value={value ?? ""}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="d-travelers">Travelers</label>
            <input id="d-travelers" type="number" min={1} max={50} placeholder="Not set" value={travelers} onChange={(e) => setTravelers(e.target.value)} />
          </div>
          <div>
            <label htmlFor="d-currency">Currency</label>
            <CurrencySelect id="d-currency" notSetLabel="Not set" value={d.currency ?? ""} onChange={(e) => set("currency", (e.target.value || null) as TripDefaults["currency"])} />
          </div>
          <div>
            <label htmlFor="d-pace">Pace</label>
            <select id="d-pace" value={d.pace ?? ""} onChange={(e) => set("pace", (e.target.value || null) as TripDefaults["pace"])}>
              <option value="">Not set</option>
              {PACES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-actions">
          <StatusLine status={status} />
          <button className="btn primary" type="submit" disabled={busy}>
            Save defaults
          </button>
        </div>
      </form>
    </section>
  );
}
