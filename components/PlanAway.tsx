"use client";

import { signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { areaQuery } from "@/lib/route";
import { Chat, type LiveTurn } from "./Chat";
import {
  api,
  downloadExport,
  streamMessage,
  type AgentEvent,
  type ExportFormat,
  type SessionUser,
  type TripSummary,
  type TripView,
  type UserRef,
} from "./client";
import { useDialogs } from "./Dialogs";
import { ItineraryPane } from "./ItineraryPane";
import { MapsProvider, usePlaceQueries, type MapsConfig } from "./places";
import { ShareDialog } from "./ShareDialog";
import { Sidebar } from "./Sidebar";
import { clampSplit, SplitHandle } from "./SplitHandle";
import { INSPIRATION_QUERIES, StartScreen } from "./StartScreen";

const POLL_MS = 4000;
/** Shown the whole time the agent works. Its step-by-step status events (searching, writing...) aren't shown. */
const WORKING_STATUS = "Plotting your adventure…";
// Below this width the sidebar is a drawer (see globals.css) instead of a column.
const DRAWER_QUERY = "(max-width: 760px)";
const COLLAPSED_KEY = "planaway:sidebar-collapsed";
const CHAT_HIDDEN_KEY = "planaway:chat-hidden";
// The chat's share of the workspace width; the itinerary gets the rest.
const SPLIT_KEY = "planaway:chat-split";
const DEFAULT_SPLIT = 0.44;

export function PlanAway({ user, maps }: { user: SessionUser; maps: MapsConfig }) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [trip, setTrip] = useState<TripView | null>(null);
  const [viewing, setViewing] = useState("current");
  const [live, setLive] = useState<LiveTurn[]>([]);
  const [streamingHere, setStreamingHere] = useState(false);
  // sidebarOpen is the phone drawer; sidebarCollapsed hides the desktop column.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Hides the chat column on wide screens so the itinerary gets the full width.
  const [chatHidden, setChatHidden] = useState(false);
  const [showItinerary, setShowItinerary] = useState(false);
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const [sharingTrip, setSharingTrip] = useState<string | null>(null);
  /** Other people with the open trip on screen right now. */
  const [viewers, setViewers] = useState<UserRef[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const dialogs = useDialogs();

  // Photos for sidebar thumbnails (each trip's first destination) and the start screen's ideas.
  const photoQueries = useMemo(
    () => [...new Set([...trips.flatMap((t) => (t.destinations[0] ? [areaQuery(t.destinations[0])] : [])), ...INSPIRATION_QUERIES])],
    [trips],
  );
  const { lookup: photos } = usePlaceQueries(photoQueries);

  // The trip on screen right now. Stream events for any other trip are
  // ignored (the server still finishes and saves that turn).
  const activeId = useRef<string | null>(null);

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Remember the collapsed sidebar across visits. Read after mount so the
  // server-rendered markup matches the first client render.
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setSidebarCollapsed(true);
      if (localStorage.getItem(CHAT_HIDDEN_KEY) === "1") setChatHidden(true);
      const saved = Number(localStorage.getItem(SPLIT_KEY));
      if (saved > 0) setSplit(clampSplit(saved));
    } catch {}
  }, []);

  const resizeSplit = (value: number) => {
    setSplit(value);
    try {
      localStorage.setItem(SPLIT_KEY, String(value));
    } catch {}
  };

  const collapseSidebar = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {}
  };

  const hideChat = (hidden: boolean) => {
    setChatHidden(hidden);
    try {
      localStorage.setItem(CHAT_HIDDEN_KEY, hidden ? "1" : "0");
    } catch {}
  };

  const showSidebar = () => {
    collapseSidebar(false);
    setSidebarOpen(true);
  };

  const hideSidebar = () => {
    if (window.matchMedia(DRAWER_QUERY).matches) setSidebarOpen(false);
    else collapseSidebar(true);
  };

  /** Reloads the sidebar: the user's trips and the ones shared with them. */
  const loadTrips = useCallback(() => {
    api<TripSummary[]>("/api/trips").then(setTrips, (err: Error) => notify(err.message));
  }, [notify]);

  const showTrip = useCallback((next: TripView | null) => {
    activeId.current = next?.id ?? null;
    setTrip(next);
    setViewing("current");
    setLive([]);
    setStreamingHere(false);
    setShowItinerary(false);
    setSidebarOpen(false);
    history.replaceState(null, "", next ? `/?trip=${next.id}` : "/");
  }, []);

  const openTrip = useCallback(
    async (id: string) => {
      try {
        showTrip(await api<TripView>(`/api/trips/${id}`));
      } catch (err) {
        notify((err as Error).message);
        showTrip(null);
      }
    },
    [notify, showTrip],
  );

  /** Refetches the open trip, e.g. after a comment or a collaborator's change. */
  const refreshTrip = useCallback(async () => {
    const id = activeId.current;
    if (!id) return;
    const fresh = await api<TripView>(`/api/trips/${id}`).catch(() => null);
    if (fresh && activeId.current === id) setTrip(fresh);
  }, []);

  useEffect(() => {
    loadTrips();
    const initial = new URLSearchParams(location.search).get("trip");
    if (initial) openTrip(initial);
  }, [loadTrips, openTrip]);

  // Collaboration: poll the trip's revision and refetch when anyone changes
  // it. Paused while this tab streams its own turn. Each poll also says this
  // user is here and returns who else is, for the viewer avatars.
  const tripId = trip?.id;
  const revision = trip?.revision;
  useEffect(() => setViewers([]), [tripId]);
  useEffect(() => {
    if (!tripId || streamingHere) return;
    const poll = async () => {
      if (document.hidden) return;
      const r = await api<{ revision: number; viewers: UserRef[] }>(`/api/trips/${tripId}/revision`).catch(() => null);
      if (!r || activeId.current !== tripId) return;
      setViewers(r.viewers);
      if (r.revision !== revision) {
        await refreshTrip();
        loadTrips();
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [tripId, revision, streamingHere, refreshTrip, loadTrips]);

  // Someone else (or this user in another tab) is running a turn.
  const busyElsewhere = !streamingHere && trip?.busy ? trip.busy : null;
  const working = streamingHere || Boolean(busyElsewhere);
  const statusText = busyElsewhere
    ? `${busyElsewhere.id === user.id ? "You are" : `${busyElsewhere.name} is`} asking PlanAway… changes will appear here.`
    : WORKING_STATUS;

  const updateLastTurn = (patch: (t: LiveTurn) => LiveTurn) =>
    setLive((turns) => (turns.length ? [...turns.slice(0, -1), patch(turns[turns.length - 1])] : turns));

  const sendMessage = useCallback(
    async (tripId: string, text: string) => {
      setLive((turns) => [...turns, { text, reply: "", error: null }]);
      setStreamingHere(true);

      const onEvent = (ev: AgentEvent) => {
        if (activeId.current !== tripId) return;
        switch (ev.type) {
          case "text":
            updateLastTurn((t) => ({ ...t, reply: t.reply + ev.text }));
            break;
          case "itinerary":
            setTrip((t) => (t && t.id === tripId ? { ...t, itinerary: ev.itinerary } : t));
            setViewing("current");
            break;
          case "error":
            updateLastTurn((t) => ({ ...t, reply: "", error: ev.message }));
            break;
        }
      };

      try {
        await streamMessage(tripId, text, onEvent);
      } catch (err) {
        onEvent({ type: "error", message: (err as Error).message });
      }

      // Reload the saved trip so chat, title, comments, and itinerary match
      // the server. Successful turns are now in trip.chat; failed ones stay.
      if (activeId.current === tripId) {
        await refreshTrip();
        setLive((turns) => turns.filter((t) => t.error));
        setStreamingHere(false);
      }
      loadTrips();
    },
    [loadTrips, refreshTrip],
  );

  const startTrip = async (prompt: string) => {
    try {
      const created = await api<{ id: string }>("/api/trips", { method: "POST" });
      showTrip(await api<TripView>(`/api/trips/${created.id}`));
      await sendMessage(created.id, prompt);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const rename = async (tripId: string, title: string) => {
    try {
      await api(`/api/trips/${tripId}`, { method: "PATCH", body: JSON.stringify({ title }) });
      if (activeId.current === tripId) await refreshTrip();
      loadTrips();
    } catch (err) {
      notify((err as Error).message);
    }
  };

  // Trip actions from the sidebar menu. They work on any trip in the list, not
  // just the one that's open.
  const findTrip = (tripId: string) => trips.find((t) => t.id === tripId) ?? null;

  const askRename = async (tripId: string) => {
    const target = findTrip(tripId);
    if (!target) return;
    const title = await dialogs.ask({
      title: "Rename trip",
      label: "Trip name",
      defaultValue: target.title,
      confirmText: "Rename",
    });
    if (title && title !== target.title) await rename(tripId, title);
  };

  const saveVersion = async (tripId: string) => {
    try {
      const target = trip?.id === tripId ? trip : await api<TripView>(`/api/trips/${tripId}`);
      const label = await dialogs.ask({
        title: `Save a version of "${target.title}"`,
        message: "Saves a snapshot of the current draft that you can view or export later.",
        label: "Name",
        defaultValue: `Version ${target.versions.length + 1}`,
        confirmText: "Save",
      });
      if (label === null) return;
      await api(`/api/trips/${tripId}/versions`, { method: "POST", body: JSON.stringify({ label }) });
      if (activeId.current === tripId) await refreshTrip();
      notify(`Saved "${label || "version"}"`);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const exportTrip = (tripId: string, format: ExportFormat) => {
    // For the open trip, export the version on screen.
    const version = trip?.id === tripId && viewing !== "current" ? viewing : null;
    downloadExport(tripId, format, version).catch((err: Error) => notify(err.message));
  };

  const deleteTrip = async (tripId: string) => {
    const target = findTrip(tripId);
    if (!target) return;
    const ok = await dialogs.confirm({
      title: `Delete "${target.title}"?`,
      message: "This deletes the trip, its chat, comments, and saved versions for everyone who has access to it.",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/trips/${tripId}`, { method: "DELETE" });
      if (activeId.current === tripId) showTrip(null);
      loadTrips();
      notify("Trip deleted");
    } catch (err) {
      notify((err as Error).message);
    }
  };

  /** Gives up access to a trip someone shared through an invite link. */
  const leaveTrip = async (tripId: string) => {
    const target = findTrip(tripId);
    if (!target) return;
    const ok = await dialogs.confirm({
      title: `Leave "${target.title}"?`,
      message: "You'll lose access to this trip until someone shares it with you again.",
      confirmText: "Leave",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/trips/${tripId}/members/${user.id}`, { method: "DELETE" });
      if (activeId.current === tripId) showTrip(null);
      loadTrips();
      notify("You left the trip");
    } catch (err) {
      notify((err as Error).message);
    }
  };

  return (
    <MapsProvider value={maps}>
      <div
        className={`app ${sidebarOpen ? "sidebar-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
        onClick={(e) => {
          if (sidebarOpen && !(e.target as Element).closest(".sidebar, .open-sidebar")) setSidebarOpen(false);
        }}
      >
        <Sidebar
          user={user}
          trips={trips}
          lookup={photos}
          activeId={trip?.id ?? null}
          onSelect={openTrip}
          onNewTrip={() => showTrip(null)}
          onRename={askRename}
          onSaveVersion={saveVersion}
          onExport={exportTrip}
          onShare={setSharingTrip}
          onDelete={deleteTrip}
          onLeave={leaveTrip}
          onSignOut={() => signOut({ redirectTo: "/login" })}
          onHide={hideSidebar}
        />

        <main className="main">
          {trip ? (
            <section
              className={`workspace ${showItinerary ? "show-itinerary" : ""} ${chatHidden ? "chat-hidden" : ""}`}
              style={{ "--chat-fr": `${split}fr`, "--pane-fr": `${1 - split}fr` } as React.CSSProperties}
            >
              <Chat
                trip={trip}
                user={user}
                live={live}
                working={working}
                status={statusText}
                onSend={(text) => sendMessage(trip.id, text)}
                onRename={(title) => rename(trip.id, title)}
                onOpenSidebar={showSidebar}
                onShowItinerary={() => setShowItinerary(true)}
                onHide={() => hideChat(true)}
              />
              <SplitHandle split={split} onChange={resizeSplit} onReset={() => resizeSplit(DEFAULT_SPLIT)} />
              <ItineraryPane
                trip={trip}
                user={user}
                viewing={viewing}
                viewers={viewers}
                working={working}
                onView={setViewing}
                onSaveVersion={() => saveVersion(trip.id)}
                onExport={(format) => exportTrip(trip.id, format)}
                onBack={() => setShowItinerary(false)}
                chatHidden={chatHidden}
                onShowChat={() => hideChat(false)}
                onShowTrips={sidebarCollapsed ? showSidebar : undefined}
                onChanged={refreshTrip}
                onError={notify}
              />
            </section>
          ) : (
            <StartScreen onStart={startTrip} onOpenSidebar={showSidebar} userName={user.name} lookup={photos} />
          )}
        </main>

        {sharingTrip && (
          <ShareDialog
            tripId={sharingTrip}
            tripTitle={findTrip(sharingTrip)?.title ?? "trip"}
            onClose={() => setSharingTrip(null)}
            onError={notify}
          />
        )}

        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </MapsProvider>
  );
}
