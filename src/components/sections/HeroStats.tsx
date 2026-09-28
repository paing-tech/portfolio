"use client";

import { useEffect, useState } from "react";
import { CountingNumber } from "@/components/ui/CountingNumber";
import { cn } from "@/lib/utils";

const STATS = [
  { value: 1, suffix: "+", label: "Years Experience" },
  { value: 12, label: "Projects" },
  { value: 5, label: "Awards" },
] as const;

/** Session flag so refreshes within one visit aren't counted again. */
const COUNTED_KEY = "portfolio:view-counted";

// Module-level so React Strict Mode's double effect can't record two views.
let viewsRequest: Promise<number | null> | null = null;

function loadViews() {
  if (viewsRequest) return viewsRequest;

  let counted = false;
  try {
    counted = sessionStorage.getItem(COUNTED_KEY) === "1";
  } catch {}

  viewsRequest = fetch("/api/views", { method: counted ? "GET" : "POST" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { views?: unknown } | null) => {
      if (typeof data?.views !== "number") return null;
      if (!counted) {
        try {
          sessionStorage.setItem(COUNTED_KEY, "1");
        } catch {}
      }
      return data.views;
    })
    .catch(() => null);

  return viewsRequest;
}

const numberClass = "block text-2xl font-medium tracking-tight md:text-4xl";
const labelClass = "mt-1 block text-xs leading-tight text-neutral-600 md:text-sm";

export default function HeroStats({ className }: { className?: string }) {
  const [views, setViews] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    loadViews().then((v) => alive && setViews(v));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <dl className={cn("flex gap-6 text-[#000000] md:gap-12", className)}>
      {STATS.map((s, i) => (
        <div key={s.label} className="flex flex-col-reverse">
          <dt className={labelClass}>{s.label}</dt>
          <dd>
            <CountingNumber
              value={s.value}
              suffix={"suffix" in s ? s.suffix : ""}
              delay={i * 0.1}
              className={numberClass}
            />
          </dd>
        </div>
      ))}
      <div className="flex flex-col-reverse">
        <dt className={labelClass}>Portfolio Views</dt>
        <dd>
          {typeof views === "number" ? (
            <CountingNumber value={views} className={numberClass} />
          ) : (
            <span className={cn(numberClass, "text-neutral-400")}>—</span>
          )}
        </dd>
      </div>
    </dl>
  );
}
