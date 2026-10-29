"use client";

import { useRef, useState } from "react";

export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;
const STEP = 0.05;

export const clampSplit = (value: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));

interface Props {
  /** Share of the container's width taken by the pane before the handle, 0–1. */
  split: number;
  onChange: (split: number) => void;
  onReset: () => void;
}

/** A vertical divider that resizes the panes on either side of it. Drag it, use
 *  the arrow keys while it's focused, or double-click it to reset. */
export function SplitHandle({ split, onChange, onReset }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const moveTo = (clientX: number) => {
    const rect = ref.current?.parentElement?.getBoundingClientRect();
    if (rect && rect.width > 0) onChange(clampSplit((clientX - rect.left) / rect.width));
  };

  return (
    <div
      ref={ref}
      className={`split-handle ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat and itinerary"
      aria-valuemin={MIN_SPLIT * 100}
      aria-valuemax={MAX_SPLIT * 100}
      aria-valuenow={Math.round(split * 100)}
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
        if (e.key === "ArrowLeft") onChange(clampSplit(split - STEP));
        else if (e.key === "ArrowRight") onChange(clampSplit(split + STEP));
        else if (e.key === "Home") onChange(MIN_SPLIT);
        else if (e.key === "End") onChange(MAX_SPLIT);
        else return;
        e.preventDefault();
      }}
    />
  );
}
