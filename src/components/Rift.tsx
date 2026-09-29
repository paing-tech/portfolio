"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export interface RiftHandle {
  /** Drive the rift: 0 = closed, 1 = fully open (new background fills the screen). */
  update: (progress: number) => void;
}

interface RiftProps {
  ref?: Ref<RiftHandle>;
  /** What shows through the rift — typically a full-bleed background image. */
  children: ReactNode;
  className?: string;
}

/** Progress by which the crack has run corner to corner… */
const TEAR_END = 0.3;
/** …and by which it has widened to cover the screen (the rest is a hold). */
const OPEN_END = 0.9;
/** Samples along each edge of the tear. */
const SAMPLES = 72;
/** Chance that an edge vertex throws a lightning fork. */
const BOLT_CHANCE = 0.3;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Small seeded PRNG so the tear has the same shape on every load. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
const toPath = (pts: Pt[], close: boolean) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") +
  (close ? "Z" : "");

/**
 * A jagged, glowing dimensional tear that runs diagonally from the top-left
 * to the bottom-right corner, then widens until what's inside fills the screen.
 */
export default function Rift({ ref, children, className }: RiftProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const progressRef = useRef(0);

  // Fixed per-vertex randomness: edge swell, shards, tangent shift, lightning.
  const noise = useMemo(() => {
    const rand = mulberry32(7);
    const r = () => rand() * 2 - 1;
    const ph = Array.from({ length: 4 }, () => rand() * Math.PI * 2);
    const TAU = Math.PI * 2;
    return Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const s = i / SAMPLES;
      return {
        // Slow, uneven swell of each edge so the tear isn't a uniform band.
        swellUp: 0.6 * Math.sin(TAU * 1.3 * s + ph[0]) + 0.4 * Math.sin(TAU * 3.7 * s + ph[1]),
        swellLo: 0.6 * Math.sin(TAU * 1.1 * s + ph[2]) + 0.4 * Math.sin(TAU * 4.3 * s + ph[3]),
        // Shards: cubed so most are small and a few are long — always outward.
        shardUp: Math.pow(rand(), 3),
        shardLo: Math.pow(rand(), 3),
        shiftUp: r(),
        shiftLo: r(),
        bolt:
          rand() < BOLT_CHANCE
            ? {
                side: rand() < 0.5 ? 1 : -1,
                segs: Array.from({ length: 4 + Math.floor(rand() * 3) }, () => [6 + rand() * 16, r()] as const),
              }
            : null,
      };
    });
  }, []);

  const render = useCallback(
    (p: number) => {
      const root = rootRef.current;
      const inner = innerRef.current;
      const { w: W, h: H } = sizeRef.current;
      if (!root || !inner || !W || !H) return;

      if (p <= 0) {
        root.style.visibility = "hidden";
        return;
      }
      root.style.visibility = "visible";

      const tear = clamp01(p / TEAR_END);
      const open = clamp01((p - TEAR_END) / (OPEN_END - TEAR_END));
      const diag = Math.hypot(W, H);
      const crack = Math.min(W, H) * 0.035;
      // Ease-in: the tear yawns slowly, then swallows the screen.
      const half = crack + (diag * 1.25 - crack) * open * open;

      // Spine runs past both corners so the tapered ends sit off-screen.
      const ax = -0.1 * W, ay = -0.1 * H;
      const bx = 1.1 * W, by = 1.1 * H;
      const len = Math.hypot(bx - ax, by - ay);
      const dx = (bx - ax) / len, dy = (by - ay) / len;
      const nx = -dy, ny = dx;
      const step = (len * tear) / SAMPLES;
      // Shard size is tied to the screen, not the rift, so the edge keeps a
      // torn-paper scale instead of growing giant sawteeth as it opens.
      const jag = Math.min(W, H) * 0.09 * (0.4 + 0.6 * tear);

      const upper: Pt[] = [];
      const lower: Pt[] = [];
      const branches: string[] = [];

      for (let i = 0; i <= SAMPLES; i++) {
        const s = i / SAMPLES;
        const t = s * tear; // points bunch along the torn length so far
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        const profile = Math.pow(Math.sin(Math.PI * s), 0.6); // tapers at both tips
        const width = half * profile;
        const n = noise[i];

        const wu = Math.max(0, width * (1 + 0.18 * n.swellUp) + jag * profile * (1.6 * n.shardUp + 0.25 * n.swellUp));
        const wl = Math.max(0, width * (1 + 0.18 * n.swellLo) + jag * profile * (1.6 * n.shardLo + 0.25 * n.swellLo));
        const u: Pt = [px + nx * wu + dx * step * 0.45 * n.shiftUp, py + ny * wu + dy * step * 0.45 * n.shiftUp];
        const l: Pt = [px - nx * wl + dx * step * 0.45 * n.shiftLo, py - ny * wl + dy * step * 0.45 * n.shiftLo];
        upper.push(u);
        lower.push(l);

        // Lightning: short, crooked forks crackling outward from the edge.
        if (n.bolt && i > 1 && i < SAMPLES - 1) {
          const dir = n.bolt.side;
          const start = dir > 0 ? u : l;
          const pts: Pt[] = [start];
          let [x, y] = start;
          for (const [segLen, jitter] of n.bolt.segs) {
            x += (nx * dir * 0.8 + dx * jitter * 1.2) * segLen;
            y += (ny * dir * 0.8 + dy * jitter * 1.2) * segLen;
            pts.push([x, y]);
          }
          branches.push(toPath(pts, false));
        }
      }

      const edge = toPath([...upper, ...lower.reverse()], true);
      const forks = branches.join("");
      inner.style.clipPath = `path("${edge}")`;
      svgRef.current?.querySelectorAll("path").forEach((el) => {
        el.setAttribute("d", el.dataset.part === "branch" ? forks : edge);
      });
    },
    [noise]
  );

  useImperativeHandle(
    ref,
    () => ({
      update: (p: number) => {
        progressRef.current = p;
        render(p);
      },
    }),
    [render]
  );

  useEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      sizeRef.current = { w: root.clientWidth, h: root.clientHeight };
      render(progressRef.current);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [render]);

  return (
    <div
      ref={rootRef}
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{ visibility: "hidden" }}
    >
      <div ref={innerRef} className="absolute inset-0">
        {children}
      </div>

      {/* Glow is stacked strokes (wide + faint → thin + bright): no blur filter,
          so it stays cheap to repaint every scroll frame. */}
      <svg ref={svgRef} className="absolute inset-0 h-full w-full overflow-visible motion-safe:animate-rift-flicker" aria-hidden>
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path stroke="rgba(120, 70, 255, 0.06)" strokeWidth={64} />
          <path stroke="rgba(130, 80, 255, 0.1)" strokeWidth={36} />
          <path stroke="rgba(150, 100, 255, 0.18)" strokeWidth={20} />
          <path data-part="branch" stroke="rgba(170, 120, 255, 0.3)" strokeWidth={5} />
          <path stroke="rgba(190, 150, 255, 0.35)" strokeWidth={9} />
          <path stroke="rgba(225, 205, 255, 0.9)" strokeWidth={3.5} />
          <path data-part="branch" stroke="#f3edff" strokeWidth={1.2} />
          <path stroke="#ffffff" strokeWidth={1.4} strokeLinejoin="miter" />
        </g>
      </svg>
    </div>
  );
}
