"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { cn } from "@/lib/utils";

const format = new Intl.NumberFormat("en-US");

interface CountingNumberProps {
  value: number;
  /** Appended once the displayed number reaches `value`, e.g. "+". */
  suffix?: string;
  /** Seconds. */
  duration?: number;
  /** Seconds before counting starts, once in view. */
  delay?: number;
  className?: string;
}

/** Counts up from 0 to `value` the first time it scrolls into view. */
export function CountingNumber({
  value,
  suffix = "",
  duration = 2,
  delay = 0,
  className,
}: CountingNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const render = (n: number) => {
      const shown = Math.round(n);
      el.textContent = format.format(shown) + (shown === value ? suffix : "");
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      render(value);
      return;
    }

    render(0);
    const counter = { n: 0 };
    let tween: gsap.core.Tween | undefined;

    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      tween = gsap.to(counter, {
        n: value,
        duration,
        delay,
        ease: "power3.out",
        onUpdate: () => render(counter.n),
      });
    });
    io.observe(el);

    return () => {
      io.disconnect();
      tween?.kill();
    };
  }, [value, suffix, duration, delay]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      0
    </span>
  );
}
