import { useEffect, useState } from "react";

/** This visitor's number, kept per browser session so refreshes don't recount. */
const VISITOR_KEY = "portfolio:visitor-number";

// Module-level so React Strict Mode's double effect can't record two visits.
let visitRequest: Promise<number | null> | null = null;

/**
 * Records this visit (once per session) via /api/views and resolves to this
 * visitor's number — e.g. 10 for "You're the 10th visitor". null if unavailable.
 */
export function recordVisit() {
  if (visitRequest) return visitRequest;

  let stored = 0;
  try {
    stored = Number(sessionStorage.getItem(VISITOR_KEY));
  } catch {}
  if (stored > 0) return (visitRequest = Promise.resolve(stored));

  visitRequest = fetch("/api/views", { method: "POST" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { views?: unknown } | null) => {
      if (typeof data?.views !== "number") return null;
      try {
        sessionStorage.setItem(VISITOR_KEY, String(data.views));
      } catch {}
      return data.views;
    })
    .catch(() => null);

  return visitRequest;
}

/** Records the visit on mount; `undefined` while loading, `null` if unavailable. */
export function useVisitorNumber() {
  const [visitor, setVisitor] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    recordVisit().then((n) => alive && setVisitor(n));
    return () => {
      alive = false;
    };
  }, []);

  return visitor;
}
