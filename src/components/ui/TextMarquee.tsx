"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";

interface TextMarqueeProps {
  children: React.ReactNode[];
  /** Seconds each item rests in view. */
  hold?: number;
  /** Seconds the slide to the next item takes. */
  slide?: number;
  className?: string;
  prefix?: React.ReactNode;
  /** Visible window height, px. */
  height?: number;
  /** Height of each item row, px. */
  rowHeight?: number;
}

/**
 * Vertical ticker: rests on each item for `hold`s, then slides up to the next.
 * The first item is repeated at the end so the loop wraps without a jump.
 */
export function TextMarquee({
  children,
  hold = 2.5,
  slide = 0.6,
  className,
  prefix,
  height = 48,
  rowHeight = 40,
}: TextMarqueeProps) {
  const items = React.Children.toArray(children);
  const count = items.length;
  const name = `marquee-${useId().replace(/[^\w-]/g, "")}`;

  const step = hold + slide;
  const total = step * count;
  const pct = (t: number) => `${((t / total) * 100).toFixed(3)}%`;
  let frames = "";
  for (let i = 0; i < count; i++) {
    const y = -i * rowHeight;
    frames += `${pct(i * step)}, ${pct(i * step + hold)} { transform: translateY(${y}px); }\n`;
  }
  frames += `100% { transform: translateY(${-count * rowHeight}px); }`;

  return (
    <>
      <style>
        {`
          @keyframes ${name} {
            ${frames}
          }
          .${name} {
            animation: ${name} ${total}s cubic-bezier(0.65, 0, 0.35, 1) infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .${name} { animation: none; }
          }
        `}
      </style>
      <div className={cn("flex", className)}>
        <div className="flex items-center gap-1">
          {prefix && <div className="whitespace-pre">{prefix}</div>}
          <div
            className="relative overflow-hidden mask-[linear-gradient(transparent,black_20%,black_80%,transparent)]"
            style={{ height }}
          >
            <div className={name} style={{ paddingTop: (height - rowHeight) / 2 }}>
              {[...items, items[0]].map((child, i) => (
                <div
                  key={i}
                  className="flex items-center"
                  style={{ height: rowHeight }}
                  aria-hidden={i === count || undefined}
                >
                  {child}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
