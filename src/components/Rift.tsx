"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef } from "react";
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

/** Length and width grow together; the tips reach both corners first. */
const TEAR_END = 0.32;
/** Progress by which the opening covers the screen (the rest is a hold). */
const OPEN_END = 0.82;
/** Crystal shards and sparks that break off the edge. */
const SHARDS = 26;
const SPARKS = 34;
const PANES = 38;

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

/**
 * 1D fractal noise in [-1, 1]. Linear (not smooth) interpolation between random
 * lattice values leaves sharp creases — layered over octaves it reads as a crack.
 */
function fbm(lattices: Float32Array[], x: number) {
  let sum = 0, amp = 1, norm = 0, freq = 1;
  for (const lat of lattices) {
    const xf = x * freq;
    const i = Math.floor(xf);
    const f = xf - i;
    const a = lat[i & 255];
    const b = lat[(i + 1) & 255];
    sum += amp * (a + (b - a) * f);
    norm += amp;
    amp *= 0.55;
    freq *= 2.1;
  }
  return sum / norm;
}

type Pt = [number, number];

/**
 * A dimensional tear that rips open from the centre of the screen toward the
 * top-left and bottom-right corners while widening until `children` (the next
 * scene, held still behind it) fills the screen.
 */
export default function Rift({ ref, children, className }: RiftProps) {
  const id = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const progressRef = useRef(0);

  // All randomness is fixed up front: noise lattices plus debris placement.
  const seed = useMemo(() => {
    const rand = mulberry32(11);
    const lattice = (octaves: number, shape = (v: number) => v * 2 - 1) =>
      Array.from({ length: octaves }, () => Float32Array.from({ length: 256 }, () => shape(rand())));
    return {
      meander: lattice(2),
      swellUp: lattice(2),
      swellLo: lattice(2),
      jagUp: lattice(4),
      jagLo: lattice(4),
      // Fine sawtooth teeth along the whole edge.
      teethUp: lattice(1),
      teethLo: lattice(1),
      // Spikes: mostly flat, occasionally long — linear interp makes them pointed.
      spikeUp: lattice(1, (v) => Math.pow(v, 3) * 2.2),
      spikeLo: lattice(1, (v) => Math.pow(v, 3) * 2.2),
      panes: Array.from({ length: PANES }, (_, i) => ({
        at: (Math.floor(i / 2) / (PANES / 2 - 1) * 2 - 1) * 0.92,
        side: i % 2 === 0 ? 1 : -1,
        span: 0.035 + rand() * 0.055,
        depth: 0.025 + rand() * 0.09,
        skew: rand() * 0.8 - 0.4,
        opacity: 0.18 + rand() * 0.35,
      })),
      debris: Array.from({ length: SHARDS + SPARKS }, (_, i) => {
        return {
          shard: i < SHARDS,
          at: rand() * 2 - 1, // position along the tear, -1 (top-left tip) … 1 (bottom-right)
          side: rand() < 0.5 ? 1 : -1,
          out: 0.3 + rand() * 1.4, // distance past the edge
          drift: 0.5 + rand(), // how fast it flies off as the tear widens
          size: 0.4 + rand() * 0.6,
          spin: (rand() * 2 - 1) * 60,
          tilt: (rand() * 2 - 1) * 0.7, // radians off the outward direction
          slim: 0.4 + rand() * 0.25, // crystal width / length
          forks: Array.from({ length: 7 }, () => rand()),
        };
      }),
    };
  }, []);

  const render = useCallback(
    (p: number) => {
      const root = rootRef.current;
      const world = worldRef.current;
      const svg = svgRef.current;
      const { w: W, h: H } = sizeRef.current;
      if (!root || !world || !svg || !W || !H) return;

      if (p <= 0) {
        root.style.visibility = "hidden";
        return;
      }
      root.style.visibility = "visible";

      if (p >= OPEN_END) {
        // Fully open: the tear covers the screen, so drop the clip and the edge.
        world.style.clipPath = "none";
        svg.style.visibility = "hidden";
        return;
      }
      svg.style.visibility = "visible";

      const tear = clamp01(p / TEAR_END);
      const open = clamp01(p / OPEN_END);
      const diag = Math.hypot(W, H);
      const cx = W / 2, cy = H / 2;
      // Axis from the centre toward the bottom-right corner (and back to top-left).
      const dx = W / diag, dy = H / diag;
      const nx = -dy, ny = dx;

      // Burst outward and pull the lips apart in the same motion. Limiting width
      // by length keeps the first puncture diagonal rather than a round portal.
      const reach = diag * 0.6;
      const L = reach * Math.pow(tear, 0.78) * (1 + 0.6 * open);
      const emerge = clamp01(L / (diag * 0.055));
      const crack = Math.min(W, H) * 0.06 * (1 - Math.exp(-tear * 7));
      const half = Math.min(L * 0.26, crack) + diag * 1.3 * Math.pow(open, 2.25);
      const jag = Math.min(W, H) * (0.021 + 0.035 * open) * emerge;
      const base = diag * 0.075;
      const edgeOpacity = emerge * (1 - clamp01((open - 0.72) / 0.28));
      svg.style.opacity = String(edgeOpacity);

      // Creases + fine teeth + occasional long spikes, in jag units (mostly outward).
      const edgeNoise = (jagL: Float32Array[], teethL: Float32Array[], spikeL: Float32Array[], s: number, o: number) =>
        0.4 +
        0.65 * fbm(jagL, s / base + o) +
        0.09 * fbm(teethL, s / (base * 0.08) + o) +
        0.8 * fbm(spikeL, s / (base * 0.35) + o);

      // Edge offsets at absolute arc position s (px) — tied to s, not to the tear's
      // length, so parts already torn keep their shape while the tips keep ripping.
      const edgeAt = (s: number) => {
        const u = Math.min(1, Math.abs(s) / Math.max(L, 1e-3));
        const prof = Math.pow(Math.max(0, 1 - u * u), 1.15);
        const tip = Math.pow(prof, 0.8);
        // A shared fractured seam makes the two lips feel like one torn surface.
        const m = emerge * tip * Math.min(W, H) * (
          0.018 * (fbm(seed.meander, s / (diag * 0.16) + 3.7) - fbm(seed.meander, 3.7)) +
          0.009 * (fbm(seed.jagUp, s / (diag * 0.045) + 2) - fbm(seed.jagUp, 2))
        );
        const px = cx + dx * s + nx * m;
        const py = cy + dy * s + ny * m;
        const up = Math.max(
          0,
          half * prof * (1 + 0.15 * fbm(seed.swellUp, s / (diag * 0.25))) +
            jag * tip * edgeNoise(seed.jagUp, seed.teethUp, seed.spikeUp, s, 0)
        );
        const lo = Math.max(
          0,
          half * prof * (1 + 0.15 * fbm(seed.swellLo, s / (diag * 0.25) + 9.1)) +
            jag * tip * edgeNoise(seed.jagLo, seed.teethLo, seed.spikeLo, s, 5.3)
        );
        return { px, py, up, lo };
      };

      const spacing = Math.max(diag / 650, 2);
      const upper: Pt[] = [];
      const lower: Pt[] = [];
      const ss = [-L];
      for (let s = Math.ceil(-L / spacing) * spacing; s < L; s += spacing) ss.push(s);
      ss.push(L);
      for (const s of ss) {
        const e = edgeAt(s);
        upper.push([e.px + nx * e.up, e.py + ny * e.up]);
        lower.push([e.px - nx * e.lo, e.py - ny * e.lo]);
      }
      const ring = [...upper, ...lower.reverse()];
      const edge = "M" + ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";

      world.style.clipPath = `path("${edge}")`;
      svg.querySelectorAll<SVGPathElement>("[data-edge]").forEach((el) => el.setAttribute("d", edge));

      // Fractured sheets stay rooted to the lips. Different depths and oblique
      // facets suggest a surface breaking into glass, rather than a drawn border.
      svg.querySelectorAll<SVGGElement>("[data-pane]").forEach((el, i) => {
        const d = seed.panes[i];
        const s = d.at * reach;
        const born = clamp01((L - Math.abs(s)) / (reach * 0.15));
        el.setAttribute("opacity", String(born * d.opacity * (1 - open * 0.6)));
        if (born <= 0) return;
        const span = Math.min(W, H) * d.span * born;
        const depth = Math.min(W, H) * d.depth * born;
        const lip = (at: number): Pt => {
          const e = edgeAt(at);
          const off = d.side > 0 ? e.up : -e.lo;
          return [e.px + nx * off, e.py + ny * off];
        };
        const a = lip(s - span * 0.5), b = lip(s + span * 0.5);
        const c: Pt = [b[0] + nx * depth * d.side + dx * span * d.skew,
          b[1] + ny * depth * d.side + dy * span * d.skew];
        const e: Pt = [a[0] + nx * depth * 0.55 * d.side - dx * span * 0.3,
          a[1] + ny * depth * 0.55 * d.side - dy * span * 0.3];
        const points = (pts: Pt[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        el.querySelectorAll<SVGPolygonElement>("[data-pane-face]").forEach(face => face.setAttribute("points", points([a, b, c, e])));
        el.querySelectorAll<SVGPolygonElement>("[data-pane-facet]").forEach(face => face.setAttribute("points", points([a, c, e])));
      });

      // Branching stress fractures peel away from the lips, appearing after the
      // advancing tear reaches them. Their roots stay attached when widening.
      svg.querySelectorAll<SVGPathElement>("[data-fracture]").forEach((el, i) => {
        const d = seed.debris[i];
        const s = d.at * reach * 0.85;
        const born = clamp01((L - Math.abs(s)) / (reach * 0.09));
        const e = edgeAt(s);
        const off = d.side > 0 ? e.up : -e.lo;
        const x = e.px + nx * off, y = e.py + ny * off;
        const length = Math.min(W, H) * (0.028 + d.size * 0.065) * born;
        const direction = d.at < 0 ? -1 : 1;
        const points: Pt[] = [[x, y]];
        for (let j = 1; j <= 6; j++) {
          const along = length * (j / 6 * 0.8 + (d.forks[j] - 0.5) * 0.35) * direction;
          const out = length * (j / 6 + (d.forks[6 - j] - 0.5) * 0.28) * d.side;
          points.push([x + dx * along + nx * out, y + dy * along + ny * out]);
        }
        const fork = points[2];
        const branch: Pt[] = [fork,
          [fork[0] - dx * length * 0.18 * direction + nx * length * 0.2 * d.side,
            fork[1] - dy * length * 0.18 * direction + ny * length * 0.2 * d.side],
          [fork[0] - dx * length * 0.08 * direction + nx * length * 0.42 * d.side,
            fork[1] - dy * length * 0.08 * direction + ny * length * 0.42 * d.side],
        ];
        const line = (pts: Pt[]) => "M" + pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join("L");
        el.setAttribute("d", line(points) + line(branch));
        el.setAttribute("opacity", String(born * (0.5 + d.size * 0.4) * (1 - open * 0.65)));
      });

      // Debris: appears once the rip has passed its spot, then flies outward.
      const nodes = svg.querySelectorAll<SVGElement>("[data-debris]");
      seed.debris.forEach((d, i) => {
        const el = nodes[i];
        if (!el) return;
        const s = d.at * reach;
        const born = clamp01((L - Math.abs(s)) / (reach * 0.12));
        if (born <= 0) {
          el.setAttribute("opacity", "0");
          return;
        }
        const e = edgeAt(s);
        const off = (d.side > 0 ? e.up : e.lo) + Math.min(W, H) * 0.05 * d.out * born * (1 + open * 3 * d.drift);
        const x = e.px + nx * off * d.side;
        const y = e.py + ny * off * d.side;
        el.setAttribute("opacity", String(born * (0.65 + 0.35 * d.size) * (1 - open * 0.65)));
        if (d.shard) {
          // Faceted diamonds and irregular chips fly outward and tumble.
          const len = Math.min(W, H) * 0.025 * d.size * born;
          const a = Math.atan2(ny * d.side, nx * d.side) + d.tilt + ((d.spin * (tear + open)) * Math.PI) / 180;
          el.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a * 180 / Math.PI}) scale(${len.toFixed(2)})`);
        } else {
          el.setAttribute("cx", x.toFixed(1));
          el.setAttribute("cy", y.toFixed(1));
          el.setAttribute("r", (0.8 + 1.6 * d.size).toFixed(1));
        }
      });
    },
    [seed]
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
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={{ visibility: "hidden" }}
    >
      <div ref={worldRef} className="absolute inset-0">
        {children}
      </div>

      {/* Fractured glass, violet light spill and a displaced white-hot rim create
          depth around the next scene. Energy flows without changing the aperture. */}
      <svg ref={svgRef} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <clipPath id={`${id}-opening`}><path data-edge /></clipPath>
          <filter id={`${id}-bloom`} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id={`${id}-halo`} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id={`${id}-depth`} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <filter id={`${id}-plasma`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.025 0.075" numOctaves={2} seed={8} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={13} xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="0.65" />
          </filter>
          <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f5c5ff" />
            <stop offset="0.22" stopColor="#bb46ff" />
            <stop offset="0.43" stopColor="#fff0ff" />
            <stop offset="0.58" stopColor="#ef8aff" />
            <stop offset="0.8" stopColor="#b95cff" />
            <stop offset="1" stopColor="#ffe0ff" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="1" x2="0.85" y2="0">
            <stop stopColor="#6734c7" stopOpacity="0.8" />
            <stop offset="0.4" stopColor="#9464ec" stopOpacity="0.3" />
            <stop offset="0.72" stopColor="#dbcaff" stopOpacity="0.65" />
            <stop offset="1" stopColor="#8052d6" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id={`${id}-mineral`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#d5b3ff" />
            <stop offset="0.45" stopColor="#7945b7" />
            <stop offset="0.5" stopColor="#361450" />
            <stop offset="1" stopColor="#160c29" />
          </linearGradient>
        </defs>
        <g strokeLinejoin="miter">
          {seed.panes.map((_, i) => (
            <g key={i} data-pane opacity={0}>
              <g className="motion-safe:animate-rift-shimmer" style={{ animationDelay: `${-i * 0.37}s` }}>
                <polygon data-pane-face fill={`url(#${id}-glass)`} stroke="#af80ed" strokeWidth={0.8} />
                <polygon data-pane-facet fill={i % 3 === 0 ? "#a364e9" : "#e4d6ff"} fillOpacity={0.28} stroke="#ddaeff" strokeWidth={0.55} />
              </g>
            </g>
          ))}
        </g>
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path data-edge stroke="#9727ec" strokeOpacity="0.48" strokeWidth={40} filter={`url(#${id}-bloom)`} />
          <g clipPath={`url(#${id}-opening)`}>
            <path data-edge stroke="#351061" strokeOpacity="0.65" strokeWidth={24} filter={`url(#${id}-depth)`} />
            <path data-edge stroke="#ac44ee" strokeOpacity="0.32" strokeWidth={48} filter={`url(#${id}-bloom)`} />
          </g>
          <g className="motion-safe:animate-rift-flicker">
            <path data-edge stroke="#d64bff" strokeOpacity="0.95" strokeWidth={15} filter={`url(#${id}-halo)`} />
            <g filter={`url(#${id}-plasma)`}>
              <path data-edge stroke="#e683ff" strokeWidth={6} />
              <path data-edge className="motion-safe:animate-rift-flow" stroke="#fff0ff" strokeWidth={3.4} strokeDasharray="7 29 21 47 3 19" />
            </g>
            <path data-edge stroke={`url(#${id}-light)`} strokeWidth={2.4} />
            <path data-edge stroke="#fff8ff" strokeOpacity="0.95" strokeWidth={1.1} strokeDasharray="19 8 3 17 41 11" />
          </g>
          {seed.debris.slice(0, SHARDS).map((_, i) => (
            <g key={i} className="motion-safe:animate-rift-shimmer" style={{ animationDelay: `${-i * 0.23}s` }}>
              <path data-fracture stroke={i % 3 === 0 ? "#a773e0" : "#c573e9"} strokeWidth={i % 3 === 0 ? 1.1 : 1.6} opacity={0} />
            </g>
          ))}
        </g>
        <g>
          {seed.debris.map((d, i) =>
            d.shard ? (
              <g key={i} data-debris opacity={0}>
                <polygon
                  points={i % 3 === 0
                    ? `1,0 0.15,${d.slim} -0.75,${d.slim * 0.3} -0.5,${-d.slim * 0.8} 0.3,${-d.slim}`
                    : `1,0 -0.1,${d.slim} -0.8,0 0.1,${-d.slim * 0.8}`}
                  fill={`url(#${id}-mineral)`}
                  stroke="#bb8eec"
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="miter"
                />
                <polygon
                  points={`1,0 -0.1,${d.slim} 0.05,0.02`}
                  fill={i % 2 === 0 ? "#c88eff" : "#8e4dd3"}
                  opacity={0.85}
                />
                <path
                  d={`M1 0 L0.05 0.02 L${i % 3 === 0 ? "-0.5" : "0.1"} ${-d.slim * 0.8}`}
                  fill="none"
                  stroke="#efccff"
                  strokeWidth={0.65}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : (
              <circle key={i} data-debris fill={i % 3 === 0 ? "#bcb2ce" : "#8763ac"} opacity={0} />
            )
          )}
        </g>
      </svg>
    </div>
  );
}
