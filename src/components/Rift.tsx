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
/** White dash patterns on the rim ([on, off, on, off, …] in px along the tear). */
const DASH_THICK = [7, 29, 21, 47, 3, 19];
const DASH_THIN = [19, 8, 3, 17, 41, 11];

/** True if arc position `s` lands on an "on" stretch of a repeating dash pattern. */
function onDash(pattern: number[], s: number) {
  const cycle = pattern.reduce((t, v) => t + v, 0);
  let p = ((s % cycle) + cycle) % cycle;
  for (let i = 0; i < pattern.length; i += 2) {
    if (p < pattern[i]) return true;
    p -= pattern[i];
    if (p < pattern[i + 1]) return false;
    p -= pattern[i + 1];
  }
  return false;
}

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

  // All randomness is fixed up front: the noise lattices that shape the edge.
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
      // Clear rather than "visible": an explicit visible would override the root's
      // hidden (visibility inherits), leaving a frozen edge after scrolling back up.
      svg.style.visibility = "";

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
      // White dashes anchored to arc position along the tear, not to the path's
      // length (which changes every frame and made SVG dasharrays jump around).
      const dashes = (pattern: number[]) => {
        let d = "";
        for (const [line, shift] of [[upper, 0], [lower, 53]] as const) {
          let run = false;
          for (let i = 0; i < ss.length; i++) {
            if (!onDash(pattern, ss[i] + shift)) {
              run = false;
              continue;
            }
            const [x, y] = line[i];
            d += `${run ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
            run = true;
          }
        }
        return d;
      };
      const thickD = dashes(DASH_THICK);
      const thinD = dashes(DASH_THIN);
      svg.querySelectorAll<SVGPathElement>("[data-dash]").forEach((el) =>
        el.setAttribute("d", el.dataset.dash === "thick" ? thickD : thinD)
      );

      const ring = [...upper, ...lower.reverse()];
      const edge = "M" + ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";

      world.style.clipPath = `path("${edge}")`;
      svg.querySelectorAll<SVGPathElement>("[data-edge]").forEach((el) => el.setAttribute("d", edge));

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
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={6} xChannelSelector="R" yChannelSelector="G" />
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
        </defs>
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path data-edge stroke="#9727ec" strokeOpacity="0.48" strokeWidth={40} filter={`url(#${id}-bloom)`} />
          <g clipPath={`url(#${id}-opening)`}>
            <path data-edge stroke="#351061" strokeOpacity="0.65" strokeWidth={24} filter={`url(#${id}-depth)`} />
            <path data-edge stroke="#ac44ee" strokeOpacity="0.32" strokeWidth={48} filter={`url(#${id}-bloom)`} />
          </g>
          <g>
            <path data-edge stroke="#d64bff" strokeOpacity="0.95" strokeWidth={15} filter={`url(#${id}-halo)`} />
            <g filter={`url(#${id}-plasma)`}>
              <path data-edge stroke="#e683ff" strokeWidth={6} />
              <path data-dash="thick" stroke="#fff0ff" strokeWidth={3.4} />
            </g>
            <path data-edge stroke={`url(#${id}-light)`} strokeWidth={2.4} />
            <path data-dash="thin" stroke="#fff8ff" strokeOpacity="0.95" strokeWidth={1.1} />
          </g>
        </g>
      </svg>
    </div>
  );
}
