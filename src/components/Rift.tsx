"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
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
  /** Progress last drawn, so repeated scroll updates at the same spot are free. */
  const drawnRef = useRef(-1);
  /** Touch devices / small screens: glow from stacked strokes instead of SVG blur filters. */
  const [lite, setLite] = useState(false);
  const liteRef = useRef(false);
  // Cached layer elements (looked up once per mount/mode, not every frame).
  const elsRef = useRef<{
    rim: SVGPathElement[];
    edge: SVGPathElement[];
    stick: SVGPathElement[];
    dashThick: SVGPathElement[];
    dashThin: SVGPathElement[];
    inner: SVGGElement | null;
  } | null>(null);

  // All randomness is fixed up front: the noise lattices that shape the edge.
  const seed = useMemo(() => {
    const rand = mulberry32(11);
    const lattice = (octaves: number, shape = (v: number) => v * 2 - 1) =>
      Array.from({ length: octaves }, () => Float32Array.from({ length: 256 }, () => shape(rand())));
    // Created in this fixed order so the tear keeps the same shape.
    const meander = lattice(2);
    const swellUp = lattice(2);
    const swellLo = lattice(2);
    const jagUp = lattice(4);
    const jagLo = lattice(4);
    // Fine sawtooth teeth along the whole edge.
    const teethUp = lattice(1);
    const teethLo = lattice(1);
    // Spikes: mostly flat, occasionally long — linear interp makes them pointed.
    const spikeUp = lattice(1, (v) => Math.pow(v, 3) * 2.2);
    const spikeLo = lattice(1, (v) => Math.pow(v, 3) * 2.2);
    // Rim sticks grow from the tear's biggest spikes. Spike tips sit on lattice
    // points of the spike noise, so pick the 3 strongest per lip (spread apart)
    // once here; positions are then stable, so sticks never hop between spikes.
    const pickSpikes = (lat: Float32Array, offset: number, lip: number) => {
      const cands: { i: number; v: number }[] = [];
      // Spike lattice step is reach/23 along the tear, so ±16 stays well inside it
      // (and skips the very centre, where the tear first punches through).
      for (let i = -16; i <= 16; i++) if (Math.abs(i) >= 2) cands.push({ i, v: lat[i & 255] });
      cands.sort((p1, p2) => p2.v - p1.v);
      const chosen: { i: number; v: number }[] = [];
      for (const c of cands) {
        if (chosen.length >= 3) break;
        if (chosen.every((k) => Math.abs(k.i - c.i) >= 5)) chosen.push(c);
      }
      // x: spike position in spike-lattice units along the tear (s = x · spike step).
      return chosen.map((c) => ({ x: c.i - offset, lip }));
    };
    const makeStick = (
      k: { x: number; lip: number },
      lean = (rand() - 0.5) * 0.4,
      heading?: number // fixed screen direction (radians, y down) instead of the lip's normal
    ) => ({
      ...k,
      heading,
      length: 0.14 + rand() * 0.1,
      lean,
      // Alternating turns so each stick zigzags like a crack rather than curling.
      segs: Array.from({ length: 3 }, (_, i) => [0.5 + rand() * 0.1, (i % 2 ? 1 : -1) * (0.1 + rand() * 0.55)] as const),
    });
    // lip 1 = lower-left edge (spikeUp), -1 = upper-right edge (spikeLo, offset 5.3).
    const sticks = [...pickSpikes(spikeUp[0], 0, 1), ...pickSpikes(spikeLo[0], 5.3, -1)]
      .map((k) => makeStick(k))
      // Drop the two lower-edge sticks near the tear's ends (screen corners).
      .filter((k) => !(k.lip === 1 && (k.x === -15 || k.x === 13)));
    // Centre spike on the lower edge, just below Zen's feet: runs out of its left
    // side, heading left and slightly down.
    sticks.push(makeStick({ x: 0, lip: 1 }, 0, Math.PI * 0.93));
    return {
      meander,
      swellUp,
      swellLo,
      jagUp,
      jagLo,
      teethUp,
      teethLo,
      spikeUp,
      spikeLo,
      sticks,
    };
  }, []);

  const render = useCallback(
    (p: number) => {
      const root = rootRef.current;
      const world = worldRef.current;
      const svg = svgRef.current;
      const { w: W, h: H } = sizeRef.current;
      const els = elsRef.current;
      if (!root || !world || !svg || !els || !W || !H) return;
      if (p === drawnRef.current) return;
      drawnRef.current = p;

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

      // Outline resolution: fewer points on lite devices (the outline also clips
      // the scene every frame, so point count matters twice).
      const spacing = liteRef.current ? Math.max(diag / 300, 4) : Math.max(diag / 500, 3);
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
      for (const el of els.dashThick) el.setAttribute("d", thickD);
      for (const el of els.dashThin) el.setAttribute("d", thinD);

      const ring = [...upper, ...lower.reverse()];
      const edge = "M" + ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";

      world.style.clipPath = `path("${edge}")`;

      // Rim sticks: a single glowing line continuing out from each spike tip, drawn
      // with the rim's own layers so it reads as part of the rim. Rooted on the lip
      // (so it rides outward with it) and growing longer as the rift opens.
      const unitS = Math.min(W, H);
      let sticksD = "";
      for (const k of seed.sticks) {
        const s0 = k.x * base * 0.35; // spike tip: lattice point of the spike noise
        const born = clamp01((L - Math.abs(s0)) / (reach * 0.12));
        if (born <= 0 || Math.abs(s0) >= L) continue;
        const e = edgeAt(s0);
        const off = k.lip > 0 ? e.up : -e.lo;
        let x = e.px + nx * off, y = e.py + ny * off;
        const length = unitS * k.length * born * (0.1 + 3 * open);
        const total = k.segs.reduce((t, [share]) => t + share, 0);
        // A fixed heading is the stick's overall direction: offset the start by the
        // zigzag's average turn so the kinks don't swing it off course.
        let turned = 0, avgTurn = 0;
        for (const [share, turn] of k.segs) {
          turned += turn;
          avgTurn += turned * (share / total);
        }
        let a = k.heading !== undefined ? k.heading - avgTurn : Math.atan2(ny * k.lip, nx * k.lip) + k.lean;
        sticksD += `M${x.toFixed(1)} ${y.toFixed(1)}`;
        for (const [share, turn] of k.segs) {
          a += turn;
          x += Math.cos(a) * length * (share / total);
          y += Math.sin(a) * length * (share / total);
          sticksD += `L${x.toFixed(1)} ${y.toFixed(1)}`;
        }
      }
      // Rim layers draw the edge and sticks as one path, so each glow layer
      // composites once and the sticks meet the rim in a seamless junction.
      const rimD = edge + sticksD;
      for (const el of els.rim) el.setAttribute("d", rimD);
      for (const el of els.stick) el.setAttribute("d", sticksD);
      for (const el of els.edge) el.setAttribute("d", edge);

      // Portal fill: a uniform violet veil across the opening. Fades out as
      // the rift opens fully.
      const f = clamp01((open - 0.45) / 0.4);
      const innerOpacity = emerge * (1 - f * f * (3 - 2 * f));
      const inner = els.inner;
      if (inner) {
        inner.setAttribute("opacity", innerOpacity.toFixed(3));
        inner.style.display = innerOpacity > 0 ? "" : "none";
      }

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

  // Lite mode for touch devices and small screens.
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 767px)");
    const sync = () => {
      liteRef.current = mq.matches;
      setLite(mq.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Cache the layer elements whenever the layer set changes (mount / lite switch),
  // then force a redraw into the new elements.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const all = <T extends Element>(sel: string) => Array.from(svg.querySelectorAll<T>(sel));
    elsRef.current = {
      rim: all<SVGPathElement>("[data-rim]"),
      edge: all<SVGPathElement>("[data-edge]"),
      stick: all<SVGPathElement>("[data-stick]"),
      dashThick: all<SVGPathElement>('[data-dash="thick"]'),
      dashThin: all<SVGPathElement>('[data-dash="thin"]'),
      inner: svg.querySelector<SVGGElement>("[data-inner]"),
    };
    drawnRef.current = -1;
    render(progressRef.current);
  }, [lite, render]);

  useEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      sizeRef.current = { w: root.clientWidth, h: root.clientHeight };
      drawnRef.current = -1;
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
          {/* Filter regions are the viewport (userSpaceOnUse), not 3× each path's
              bounding box — the rim spans the screen, so the default region made
              every blur process ~9 screens of pixels per frame. */}
          <filter id={`${id}-bloom`} filterUnits="userSpaceOnUse" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id={`${id}-halo`} filterUnits="userSpaceOnUse" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id={`${id}-depth`} filterUnits="userSpaceOnUse" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="5" />
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

        {/* Portal fill: a uniform violet veil over the opening (see render). */}
        <g data-inner>
          <path data-edge fill="#7b3dff" fillOpacity={0.35} />
        </g>

        {lite ? (
          // Lite: the same look from stacked translucent strokes — no SVG filters,
          // which phones render at 2–3× pixel density every frame.
          <g fill="none" strokeLinejoin="round" strokeLinecap="round">
            {/* Many faint steps approximate a blur's smooth falloff. */}
            {[48, 40, 32, 24].map((w) => (
              <path key={w} data-rim stroke="#9727ec" strokeOpacity="0.07" strokeWidth={w} />
            ))}
            <g clipPath={`url(#${id}-opening)`}>
              {[76, 64, 52, 42].map((w) => (
                <path key={w} data-edge stroke="#2a0a4f" strokeOpacity="0.1" strokeWidth={w} />
              ))}
              {[34, 28, 22, 16, 10].map((w) => (
                <path key={w} data-edge stroke="#12031f" strokeOpacity="0.16" strokeWidth={w} />
              ))}
            </g>
            <path data-rim stroke="#d64bff" strokeOpacity="0.35" strokeWidth={16} />
            <path data-rim stroke="#d64bff" strokeOpacity="0.6" strokeWidth={10} />
            <path data-rim stroke="#e683ff" strokeWidth={6} />
            <path data-dash="thick" stroke="#fff0ff" strokeWidth={3.4} />
            <path data-rim stroke={`url(#${id}-light)`} strokeWidth={2.4} />
            <path data-dash="thin" stroke="#fff8ff" strokeOpacity="0.95" strokeWidth={1.1} />
            <path data-stick stroke="#fff8ff" strokeOpacity="0.95" strokeWidth={1.4} />
          </g>
        ) : (
          <g fill="none" strokeLinejoin="round" strokeLinecap="round">
            {/* data-rim layers carry the edge plus the sticks (see render). */}
            <path data-rim stroke="#9727ec" strokeOpacity="0.48" strokeWidth={40} filter={`url(#${id}-bloom)`} />
            <g clipPath={`url(#${id}-opening)`}>
              {/* Inner rim shadow: a dark band just inside the edge, then a wider falloff. */}
              <path data-edge stroke="#12031f" strokeOpacity="0.9" strokeWidth={32} filter={`url(#${id}-depth)`} />
              <path data-edge stroke="#2a0a4f" strokeOpacity="0.6" strokeWidth={70} filter={`url(#${id}-bloom)`} />
            </g>
            <path data-rim stroke="#d64bff" strokeOpacity="0.95" strokeWidth={15} filter={`url(#${id}-halo)`} />
            <path data-rim stroke="#e683ff" strokeWidth={6} />
            <path data-dash="thick" stroke="#fff0ff" strokeWidth={3.4} />
            <path data-rim stroke={`url(#${id}-light)`} strokeWidth={2.4} />
            <path data-dash="thin" stroke="#fff8ff" strokeOpacity="0.95" strokeWidth={1.1} />
            {/* Sticks' white centre, like the rim's white core. */}
            <path data-stick stroke="#fff8ff" strokeOpacity="0.95" strokeWidth={1.4} />
          </g>
        )}
      </svg>
    </div>
  );
}
