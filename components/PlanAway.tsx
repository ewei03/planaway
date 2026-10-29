"use client";

import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat, type LiveTurn } from "./Chat";
import { api, canEdit, streamMessage, type AgentEvent, type GroupSummary, type SessionUser, type TripView } from "./client";
import { useDialogs } from "./Dialogs";
import { GroupDialog } from "./GroupDialog";
import { ItineraryPane } from "./ItineraryPane";
import { MapsProvider, type MapsConfig } from "./places";
import { Sidebar } from "./Sidebar";
import { clampSplit, SplitHandle } from "./SplitHandle";
import { StartScreen } from "./StartScreen";

const POLL_MS = 4000;
const ASK_ABOUT_COMMENTS = "Please go through the open comments and update the plan where it makes sense.";
// Below this width the sidebar is a drawer (see globals.css) instead of a column.
const DRAWER_QUERY = "(max-width: 760px)";
const COLLAPSED_KEY = "planaway:sidebar-collapsed";
// The chat's share of the workspace width; the itinerary gets the rest.
const SPLIT_KEY = "planaway:chat-split";
const DEFAULT_SPLIT = 0.44;

export function PlanAway({ user, maps }: { user: SessionUser; maps: MapsConfig }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  // Until the first load, there's no group to create a trip in yet.
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [trip, setTrip] = useState<TripView | null>(null);
  const [newTripGroup, setNewTripGroup] = useState<string | null>(null);
  const [viewing, setViewing] = useState("current");
  const [live, setLive] = useState<LiveTurn[]>([]);
  const [streamingHere, setStreamingHere] = useState(false);
  const [status, setStatus] = useState("");
  // sidebarOpen is the phone drawer; sidebarCollapsed hides the desktop column.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showItinerary, setShowItinerary] = useState(false);
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const [managingGroup, setManagingGroup] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dialogs = useDialogs();

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

  const showSidebar = () => {
    collapseSidebar(false);
    setSidebarOpen(true);
  };

  const hideSidebar = () => {
    if (window.matchMedia(DRAWER_QUERY).matches) setSidebarOpen(false);
    else collapseSidebar(true);
  };

  const loadGroups = useCallback(() => {
    api<GroupSummary[]>("/api/groups").then(
      (g) => {
        setGroups(g);
        setGroupsLoaded(true);
      },
      (err: Error) => notify(err.message),
    );
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
    loadGroups();
    const initial = new URLSearchParams(location.search).get("trip");
    if (initial) openTrip(initial);
  }, [loadGroups, openTrip]);

  // Collaboration: poll the trip's revision and refetch when anyone changes
  // it. Paused while this tab streams its own turn.
  const tripId = trip?.id;
  const revision = trip?.revision;
  useEffect(() => {
    if (!tripId || streamingHere) return;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const r = await api<{ revision: number }>(`/api/trips/${tripId}/revision`).catch(() => null);
      if (r && r.revision !== revision) {
        await refreshTrip();
        loadGroups();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [tripId, revision, streamingHere, refreshTrip, loadGroups]);

  // Someone else (or this user in another tab) is running a turn.
  const busyElsewhere = !streamingHere && trip?.busy ? trip.busy : null;
  const working = streamingHere || Boolean(busyElsewhere);
  const statusText = busyElsewhere
    ? `${busyElsewhere.id === user.id ? "You are" : `${busyElsewhere.name} is`} asking PlanAway… changes will appear here.`
    : status;

  const updateLastTurn = (patch: (t: LiveTurn) => LiveTurn) =>
    setLive((turns) => (turns.length ? [...turns.slice(0, -1), patch(turns[turns.length - 1])] : turns));

  const sendMessage = useCallback(
    async (tripId: string, text: string) => {
      setLive((turns) => [...turns, { text, reply: "", error: null }]);
      setStreamingHere(true);
      setStatus("Thinking…");

      const onEvent = (ev: AgentEvent) => {
        if (activeId.current !== tripId) return;
        switch (ev.type) {
          case "text":
            updateLastTurn((t) => ({ ...t, reply: t.reply + ev.text }));
            break;
          case "status":
            setStatus(ev.text);
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
      loadGroups();
    },
    [loadGroups, refreshTrip],
  );

  const editableGroups = groups.filter((g) => canEdit(g.role));
  const startGroupId = newTripGroup && editableGroups.some((g) => g.id === newTripGroup) ? newTripGroup : editableGroups[0]?.id;

  const startTrip = async (prompt: string) => {
    if (!startGroupId) return notify("You need editor access to a group to create trips.");
    try {
      const created = await api<{ id: string }>("/api/trips", { method: "POST", body: JSON.stringify({ groupId: startGroupId }) });
      showTrip(await api<TripView>(`/api/trips/${created.id}`));
      await sendMessage(created.id, prompt);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const rename = async (title: string) => {
    if (!trip) return;
    try {
      await api(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      await refreshTrip();
      loadGroups();
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const saveVersion = async () => {
    if (!trip) return;
    const label = await dialogs.ask({
      title: "Save this version",
      message: "Saves a snapshot of the current draft that you can view or export later.",
      label: "Name",
      defaultValue: `Version ${trip.versions.length + 1}`,
      confirmText: "Save",
    });
    if (label === null) return;
    try {
      await api(`/api/trips/${trip.id}/versions`, { method: "POST", body: JSON.stringify({ label }) });
      await refreshTrip();
      notify(`Saved "${label || "version"}"`);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const deleteTrip = async () => {
    if (!trip) return;
    const ok = await dialogs.confirm({
      title: `Delete "${trip.title}"?`,
      message: `This deletes the trip, its chat, comments, and saved versions for everyone in ${trip.groupName}.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/trips/${trip.id}`, { method: "DELETE" });
      showTrip(null);
      loadGroups();
      notify("Trip deleted");
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const newGroup = async () => {
    const name = await dialogs.ask({
      title: "New group",
      message: "Trips in a group are shared with everyone you invite to it.",
      label: "Group name",
      placeholder: "e.g. Ski crew, Family",
      confirmText: "Create group",
    });
    if (!name) return;
    try {
      const { id } = await api<{ id: string }>("/api/groups", { method: "POST", body: JSON.stringify({ name }) });
      loadGroups();
      setManagingGroup(id);
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
          groups={groups}
          activeId={trip?.id ?? null}
          onSelect={openTrip}
          onNewTrip={(groupId) => {
            setNewTripGroup(groupId);
            showTrip(null);
          }}
          onNewGroup={newGroup}
          onManageGroup={setManagingGroup}
          onSignOut={() => signOut({ redirectTo: "/login" })}
          onHide={hideSidebar}
        />

        <main className="main">
          {trip ? (
            <section
              className={`workspace ${showItinerary ? "show-itinerary" : ""}`}
              style={{ "--chat-fr": `${split}fr`, "--pane-fr": `${1 - split}fr` } as React.CSSProperties}
            >
              <Chat
                trip={trip}
                user={user}
                live={live}
                working={working}
                status={statusText}
                onSend={(text) => sendMessage(trip.id, text)}
                onRename={rename}
                onOpenSidebar={showSidebar}
                onShowItinerary={() => setShowItinerary(true)}
              />
              <SplitHandle split={split} onChange={resizeSplit} onReset={() => resizeSplit(DEFAULT_SPLIT)} />
              <ItineraryPane
                trip={trip}
                user={user}
                viewing={viewing}
                working={working}
                onView={setViewing}
                onSaveVersion={saveVersion}
                onDelete={deleteTrip}
                onBack={() => setShowItinerary(false)}
                onChanged={refreshTrip}
                onAskAgent={() => sendMessage(trip.id, ASK_ABOUT_COMMENTS)}
                onError={notify}
              />
            </section>
          ) : (
            <StartScreen
              groups={editableGroups}
              groupId={startGroupId ?? ""}
              onGroupChange={setNewTripGroup}
              onStart={startTrip}
              onOpenSidebar={showSidebar}
              loading={!groupsLoaded}
            />
          )}
        </main>

        {managingGroup && (
          <GroupDialog
            groupId={managingGroup}
            user={user}
            onClose={() => setManagingGroup(null)}
            onChanged={loadGroups}
            onGone={() => {
              setManagingGroup(null);
              if (trip && trip.groupId === managingGroup) showTrip(null);
            }}
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
