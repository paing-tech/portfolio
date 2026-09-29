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

/** Progress by which the tear has ripped from the centre past both corners… */
const TEAR_END = 0.35;
/** …and by which it has widened to cover the screen (the rest is a hold). */
const OPEN_END = 0.9;
/** Crystal shards and sparks that break off the edge. */
const SHARDS = 22;
const SPARKS = 28;

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
 * top-left and bottom-right corners, then widens until `children` (the next
 * scene, held still behind it) fills the screen.
 */
export default function Rift({ ref, children, className }: RiftProps) {
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
      debris: Array.from({ length: SHARDS + SPARKS }, (_, i) => {
        return {
          shard: i < SHARDS,
          at: rand() * 2 - 1, // position along the tear, -1 (top-left tip) … 1 (bottom-right)
          side: rand() < 0.5 ? 1 : -1,
          out: 0.3 + rand() * 1.4, // distance past the edge, in jag units
          drift: 0.5 + rand(), // how fast it flies off as the tear widens
          size: 0.25 + rand() * 0.75,
          spin: (rand() * 2 - 1) * 60,
          tilt: (rand() * 2 - 1) * 0.7, // radians off the outward direction
          slim: 0.25 + rand() * 0.2, // crystal width / length
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
      const open = clamp01((p - TEAR_END) / (OPEN_END - TEAR_END));
      const diag = Math.hypot(W, H);
      const cx = W / 2, cy = H / 2;
      // Axis from the centre toward the bottom-right corner (and back to top-left).
      const dx = W / diag, dy = H / diag;
      const nx = -dy, ny = dx;

      // Rip: fast at first, easing as the tips race past the corners.
      const reach = diag * 0.6;
      const L = reach * (1 - Math.pow(1 - tear, 2.2)) * (1 + 0.6 * open);
      const crack = Math.min(W, H) * 0.05;
      const half = crack * (0.25 + 0.75 * tear) + diag * 1.3 * open * open;
      const jag = Math.min(W, H) * 0.09 * (0.5 + 0.5 * tear);
      const base = diag * 0.1; // coarsest crease length

      // Creases + fine teeth + occasional long spikes, in jag units (mostly outward).
      const edgeNoise = (jagL: Float32Array[], teethL: Float32Array[], spikeL: Float32Array[], s: number, o: number) =>
        0.5 +
        1.1 * fbm(jagL, s / base + o) +
        0.35 * fbm(teethL, s / (base * 0.08) + o) +
        fbm(spikeL, s / (base * 0.22) + o);

      // Edge offsets at absolute arc position s (px) — tied to s, not to the tear's
      // length, so parts already torn keep their shape while the tips keep ripping.
      const edgeAt = (s: number) => {
        const u = Math.min(1, Math.abs(s) / Math.max(L, 1e-3));
        const prof = Math.pow(Math.cos((u * Math.PI) / 2), 0.8); // widest mid, pointed tips
        const tip = Math.pow(prof, 1.4); // roughness fades out along the tip → needle points
        const m = diag * 0.05 * fbm(seed.meander, s / (diag * 0.35) + 3.7) * tip;
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

      const spacing = Math.max(diag / 150, 6);
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
        const off = (d.side > 0 ? e.up : e.lo) + jag * d.out * (1 + open * 6 * d.drift);
        const x = e.px + nx * off * d.side;
        const y = e.py + ny * off * d.side;
        el.setAttribute("opacity", String(born));
        if (d.shard) {
          // Elongated crystal (kite) pointing away from the tear, slowly turning.
          const len = jag * 0.6 * d.size * (0.6 + 0.4 * born);
          const wid = len * d.slim;
          const a = Math.atan2(ny * d.side, nx * d.side) + d.tilt + ((d.spin * (tear + open)) * Math.PI) / 180;
          const ca = Math.cos(a), sa = Math.sin(a);
          const kite: Pt[] = [[len, 0], [0, wid], [-len * 0.4, 0], [0, -wid]];
          el.setAttribute(
            "points",
            kite.map(([u, v]) => `${(x + u * ca - v * sa).toFixed(1)},${(y + u * sa + v * ca).toFixed(1)}`).join(" ")
          );
        } else {
          el.setAttribute("cx", x.toFixed(1));
          el.setAttribute("cy", y.toFixed(1));
          el.setAttribute("r", (1.2 + 2.4 * d.size).toFixed(1));
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

      {/* Edge styled after the rift artwork: soft lavender glow, a dark indigo rim,
          and a bright inner line. Stacked strokes, no blur filters — cheap per frame. */}
      <svg ref={svgRef} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <g className="motion-safe:animate-rift-flicker" fill="none" strokeLinejoin="round">
          <path data-edge stroke="rgba(150, 100, 255, 0.1)" strokeWidth={64} />
          <path data-edge stroke="rgba(170, 125, 255, 0.2)" strokeWidth={34} />
          <path data-edge stroke="rgba(200, 165, 255, 0.55)" strokeWidth={18} />
          <path data-edge stroke="rgba(245, 235, 255, 0.9)" strokeWidth={9} />
          <path data-edge stroke="#2d1080" strokeWidth={4.5} strokeLinejoin="miter" />
          <path data-edge stroke="#c9a8ff" strokeWidth={1.2} strokeLinejoin="miter" />
        </g>
        <g>
          {seed.debris.map((d, i) =>
            d.shard ? (
              <polygon
                key={i}
                data-debris
                fill="#2b1277"
                stroke="#b48cff"
                strokeWidth={1.2}
                strokeLinejoin="miter"
                opacity={0}
              />
            ) : (
              <circle key={i} data-debris fill="#8a5cff" opacity={0} />
            )
          )}
        </g>
      </svg>
    </div>
  );
}
