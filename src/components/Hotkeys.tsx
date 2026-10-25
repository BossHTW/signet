"use client";
import { useEffect } from "react";
// Keyboard shortcuts for the one-card-at-a-time review: each key clicks the element with the given id.
export function Hotkeys({ map }: { map: Record<string, string> }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const id = map[e.key];
      if (!id) return;
      const el = document.getElementById(id) as HTMLElement | null;
      if (el && !(el as HTMLButtonElement).disabled) { e.preventDefault(); el.click(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [map]);
  return null;
}
