"use client";

import { useRef, useState } from "react";

/** The chat's width in pixels; the itinerary takes the rest (at least 380px, set in globals.css). */
export const MIN_CHAT = 320;
export const MAX_CHAT = 640;
export const DEFAULT_CHAT = 440;
const CHAT_STEP = 20;

export const clampChat = (value: number) => Math.round(Math.min(MAX_CHAT, Math.max(MIN_CHAT, value)));

/** The sidebar's width in pixels: wide enough for trip names, never crowding the work. */
export const MIN_SIDEBAR = 220;
export const MAX_SIDEBAR = 420;
export const DEFAULT_SIDEBAR = 280;
const SIDEBAR_STEP = 20;

export const clampSidebar = (value: number) => Math.round(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, value)));

/** The divider between chat and itinerary, in pixels from the left of the workspace. Drag it, use
 *  the arrow keys while it's focused, or double-click it to reset. */
export function SplitHandle({ width, onChange, onReset }: { width: number; onChange: (width: number) => void; onReset: () => void }) {
  return (
    <ResizeHandle
      label="Resize chat and itinerary"
      value={width}
      min={MIN_CHAT}
      max={MAX_CHAT}
      step={CHAT_STEP}
      fromPointer={(x, rect) => x - rect.left}
      onChange={(v) => onChange(clampChat(v))}
      onReset={onReset}
    />
  );
}

/** The divider on the sidebar's right edge, in pixels from the left of the app. */
export function SidebarHandle({ width, onChange, onReset }: { width: number; onChange: (width: number) => void; onReset: () => void }) {
  return (
    <ResizeHandle
      className="sidebar-handle"
      label="Resize sidebar"
      value={width}
      min={MIN_SIDEBAR}
      max={MAX_SIDEBAR}
      step={SIDEBAR_STEP}
      fromPointer={(x, rect) => x - rect.left}
      onChange={(v) => onChange(clampSidebar(v))}
      onReset={onReset}
    />
  );
}

/** Drag, arrow keys, Home/End, and double-click to reset; the value is measured against the parent element. */
function ResizeHandle(props: {
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fromPointer: (clientX: number, parent: DOMRect) => number;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const { className = "split-handle", label, value, min, max, step, fromPointer, onChange, onReset } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const moveTo = (clientX: number) => {
    const rect = ref.current?.parentElement?.getBoundingClientRect();
    if (rect) onChange(fromPointer(clientX, rect));
  };

  return (
    <div
      ref={ref}
      className={`${className} ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => dragging && moveTo(e.clientX)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(value - step);
        else if (e.key === "ArrowRight") onChange(value + step);
        else if (e.key === "Home") onChange(min);
        else if (e.key === "End") onChange(max);
        else return;
        e.preventDefault();
      }}
    />
  );
}
