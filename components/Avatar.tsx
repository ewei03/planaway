import { useState } from "react";

/** A person's profile photo, or their initial when they have none (or it fails to load). */
export function Avatar({ name, url, className = "avatar" }: { name: string; url?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className={className} aria-hidden="true">
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : initial}
    </span>
  );
}
