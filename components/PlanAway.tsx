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
import { TripSkeleton } from "./Skeleton";
import { clampChat, clampSidebar, DEFAULT_CHAT, DEFAULT_SIDEBAR, SidebarHandle, SplitHandle } from "./SplitHandle";
import { INSPIRATION_QUERIES, StartScreen } from "./StartScreen";
import { VerifyEmailPrompt } from "./VerifyEmail";
import type { UserSettings } from "@/lib/settings";

const POLL_MS = 4000;
/** Shown the whole time the agent works. Its step-by-step status events (searching, writing...) aren't shown. */
const WORKING_STATUS = "Plotting your adventure…";
// Below this width the sidebar is a drawer (see globals.css) instead of a column.
const DRAWER_QUERY = "(max-width: 760px)";
const COLLAPSED_KEY = "planaway:sidebar-collapsed";
const CHAT_HIDDEN_KEY = "planaway:chat-hidden";
// The chat's share of the workspace width; the itinerary gets the rest.
// The chat's width in pixels (it used to be a share of the width, under planaway:chat-split).
const CHAT_WIDTH_KEY = "planaway:chat-width";
const SIDEBAR_WIDTH_KEY = "planaway:sidebar-width";

/** The user's activity colors as the CSS variables the itinerary's icons read. */
function activityColorVars(colors: UserSettings["activityColors"]): React.CSSProperties {
  return Object.fromEntries(Object.entries(colors).map(([category, color]) => [`--cat-${category}`, color]));
}

export function PlanAway({
  user,
  settings,
  maps,
  initialTripId = null,
}: {
  user: SessionUser;
  settings: UserSettings;
  maps: MapsConfig;
  /** The trip in the URL, known on the server, so the first render shows it loading rather than the start screen. */
  initialTripId?: string | null;
}) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [trip, setTrip] = useState<TripView | null>(null);
  const [tripsLoaded, setTripsLoaded] = useState(false);
  /** The trip being fetched, shown as a skeleton meanwhile. */
  const [opening, setOpening] = useState<string | null>(initialTripId);
  // The latest trip asked for; a slower, earlier request mustn't replace it.
  const openingRef = useRef<string | null>(initialTripId);
  /** Switching from one open trip to another: wait a moment before the skeleton, so quick loads don't flash. */
  const [openingSlow, setOpeningSlow] = useState(false);
  const [viewing, setViewing] = useState("current");
  const [live, setLive] = useState<LiveTurn[]>([]);
  const [streamingHere, setStreamingHere] = useState(false);
  // The trip this tab's agent turn is running on, even after switching away.
  // Each person runs one turn at a time (the server enforces it too).
  const [planningId, setPlanningId] = useState<string | null>(null);
  // sidebarOpen is the phone drawer; sidebarCollapsed hides the desktop column.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Hides the chat column on wide screens so the itinerary gets the full width.
  const [chatHidden, setChatHidden] = useState(false);
  const [showItinerary, setShowItinerary] = useState(false);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
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
      const saved = Number(localStorage.getItem(CHAT_WIDTH_KEY));
      if (saved > 0) setChatWidth(clampChat(saved));
      const width = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (width > 0) setSidebarWidth(clampSidebar(width));
    } catch {}
  }, []);

  const resizeSidebar = (value: number) => {
    setSidebarWidth(value);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(value));
    } catch {}
  };

  const resizeChat = (value: number) => {
    setChatWidth(value);
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(value));
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
    api<TripSummary[]>("/api/trips")
      .then(setTrips, (err: Error) => notify(err.message))
      .finally(() => setTripsLoaded(true));
  }, [notify]);

  useEffect(() => {
    if (!opening) return setOpeningSlow(false);
    const timer = setTimeout(() => setOpeningSlow(true), 200);
    return () => clearTimeout(timer);
  }, [opening]);
  // With nothing on screen yet, show the skeleton at once; otherwise keep the old trip briefly.
  const showTripSkeleton = opening !== null && (!trip || openingSlow);

  const showTrip = useCallback((next: TripView | null) => {
    openingRef.current = null;
    setOpening(null);
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
      openingRef.current = id;
      setOpening(id);
      try {
        const next = await api<TripView>(`/api/trips/${id}`);
        if (openingRef.current === id) showTrip(next);
      } catch (err) {
        if (openingRef.current !== id) return;
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
      setPlanningId(tripId);

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
      setPlanningId(null);
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

  const completeTrip = async (tripId: string, completed: boolean) => {
    try {
      await api(`/api/trips/${tripId}`, { method: "PATCH", body: JSON.stringify({ completed }) });
      loadTrips();
      notify(completed ? "Moved to Completed trips" : "Moved out of Completed trips");
    } catch (err) {
      notify((err as Error).message);
    }
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
        style={{ ...activityColorVars(settings.activityColors), "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
        onClick={(e) => {
          if (sidebarOpen && !(e.target as Element).closest(".sidebar, .open-sidebar")) setSidebarOpen(false);
        }}
      >
        <Sidebar
          user={user}
          trips={trips}
          loading={!tripsLoaded}
          lookup={photos}
          activeId={trip?.id ?? null}
          onSelect={openTrip}
          onNewTrip={() => showTrip(null)}
          onRename={askRename}
          onSaveVersion={saveVersion}
          onExport={exportTrip}
          onShare={setSharingTrip}
          onComplete={completeTrip}
          onDelete={deleteTrip}
          onLeave={leaveTrip}
          onSignOut={() => signOut({ redirectTo: "/login" })}
          onHide={hideSidebar}
        />
        {!sidebarCollapsed && <SidebarHandle width={sidebarWidth} onChange={resizeSidebar} onReset={() => resizeSidebar(DEFAULT_SIDEBAR)} />}

        <main className="main">
          {showTripSkeleton ? (
            <TripSkeleton />
          ) : trip ? (
            <section
              className={`workspace ${showItinerary ? "show-itinerary" : ""} ${chatHidden ? "chat-hidden" : ""}`}
              style={{ "--chat-w": `${chatWidth}px` } as React.CSSProperties}
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
              <SplitHandle width={chatWidth} onChange={resizeChat} onReset={() => resizeChat(DEFAULT_CHAT)} />
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
                onShare={trip.role === "owner" ? () => setSharingTrip(trip.id) : undefined}
                chatHidden={chatHidden}
                onShowChat={() => hideChat(false)}
                onShowTrips={sidebarCollapsed ? showSidebar : undefined}
                onChanged={refreshTrip}
                onError={notify}
              />
            </section>
          ) : user.emailVerified === false ? (
            <VerifyEmailPrompt email={user.email} onOpenSidebar={showSidebar} />
          ) : (
            <StartScreen
              onStart={startTrip}
              onOpenSidebar={showSidebar}
              userName={user.name}
              lookup={photos}
              defaults={settings.defaults}
              pastDestinations={[...new Set(trips.flatMap((t) => t.destinations))]}
              busyWith={planningId ? (findTrip(planningId)?.title ?? "your trip") : null}
              onOpenBusy={() => planningId && openTrip(planningId)}
            />
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
