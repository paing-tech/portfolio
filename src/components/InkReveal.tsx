"use client";
import { useEffect, useRef, useCallback } from "react";

/** A letterform to punch out of the white overlay (nonzero winding). */
export interface RevealMask {
  /** Coordinate space the `letter` path is authored in. */
  width: number;
  height: number;
  /** The letterform subpath. */
  letter: string;
  /** Bounding box of `letter`, used to fit it to the viewport. */
  letterBox: { x: number; y: number; w: number; h: number };
}

interface InkRevealProps {
  /** RGB color of the mask overlay, e.g. [252, 250, 248] */
  maskColor?: [number, number, number];
  /**
   * Vector overlay drawn instead of a flat fill. Rendered "cover" over the
   * canvas; its hole grows as `revealRef` goes 0 → 1.
   */
  mask?: RevealMask;
  /** Live scroll progress (0–1). Scales the mask hole open. */
  revealRef?: React.RefObject<number>;
  /** Whether the cursor carves ink holes. Off = scroll-mask only. */
  cursorInk?: boolean;
  /** Progress value at which the overlay is fully gone; the rest is "hold". */
  openEnd?: number;
  /** Progress value at which the overlay starts dissolving away. */
  fadeStart?: number;
  /** Max multiplier applied to the fitted letter size at full open. */
  revealScaleMax?: number;
  /** Exponent on progress — >1 accelerates the open near the end. */
  revealEase?: number;
  /** Fraction of the viewport the letter fills at rest (contain-fit). */
  fitFactor?: number;
  /** Ink line traced along the cut edge so it reads on a light image. */
  edgeColor?: string;
  /** Width of that edge line, in screen px (0 disables it). */
  edgeWidth?: number;
  /** Radius of each ink stamp in px */
  brushSize?: number;
  /** How long a carved spot stays fully open before it starts healing (ms) */
  revealHold?: number;
  /** How long the heal-over fade takes once the hold ends (ms) */
  lifetime?: number;
  /** How long a stamp takes to grow from rStart to its full radius (ms) */
  expandTime?: number;
  /** Initial radius before the stamp expands */
  rStart?: number;
  /** Random variation factor for stamp radius (0–1) */
  rVary?: number;
  /** Min pixel distance between stamps along a stroke */
  stampStep?: number;
  /** Max stamps alive at once (oldest are pruned) */
  maxStamps?: number;
  /** Number of segments on the wobble circle (higher = smoother) */
  segments?: number;
  /** Wobble amplitude weights [primary, secondary, tertiary] */
  wobble?: [number, number, number];
  /** Gradient inner-radius factor (0–1, relative to stamp radius) */
  gradientInnerRadius?: number;
  /** Gradient opacity stops [center, mid, edge] */
  gradientStops?: [number, number, number];
  /** Extra CSS class for the canvas element */
  className?: string;
  /** Extra inline styles for the canvas element */
  style?: React.CSSProperties;
}

interface Stamp {
  x: number;
  y: number;
  born: number;
  seed: number;
  rmax: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export default function InkReveal({
  maskColor = [252, 250, 248],
  mask,
  revealRef,
  cursorInk = true,
  openEnd = 0.72,
  fadeStart = 0.42,
  revealScaleMax = 3.2,
  revealEase = 2.2,
  fitFactor = 0.82,
  edgeColor = "rgba(23, 20, 17, 0.62)",
  edgeWidth = 2,
  brushSize = 160,
  revealHold = 1000,
  lifetime = 800,
  expandTime = 2000,
  rStart = 10,
  rVary = 0.45,
  stampStep = 10,
  maxStamps = 400,
  segments = 36,
  wobble = [0.14, 0.08, 0.05],
  gradientInnerRadius = 0.2,
  gradientStops = [0.95, 0.88, 0],
  className,
  style,
}: InkRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stampsRef = useRef<Stamp[]>([]);
  const runningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  const loopRef = useRef<() => void>(() => {});
  const maskPathRef = useRef<Path2D | null>(null);

  const mc = maskColor;

  // Build the letterform path once per mask.
  useEffect(() => {
    maskPathRef.current =
      mask && typeof Path2D !== "undefined" ? new Path2D(mask.letter) : null;
  }, [mask]);

  /**
   * Paint the overlay: a full-canvas plane, then punch the letterform hole
   * (fitted to the viewport and scaled open by `revealRef`).
   */
  const paintMask = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = `rgb(${mc[0]},${mc[1]},${mc[2]})`;
      ctx.fillRect(0, 0, w, h);

      const letter = maskPathRef.current;
      if (mask && letter) {
        const reveal = clamp01(revealRef?.current ?? 0);
        const openT = clamp01(reveal / openEnd);
        const f = 1 + (revealScaleMax - 1) * Math.pow(openT, revealEase);
        const box = mask.letterBox;
        const s = fitFactor * Math.min(w / box.w, h / box.h) * f;

        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const place = () => {
          ctx.translate(w / 2, h / 2);
          ctx.scale(s, s);
          ctx.translate(-cx, -cy);
        };

        // Punch the hole.
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        place();
        ctx.fillStyle = "#000";
        ctx.fill(letter, "nonzero");
        ctx.restore();

        // Ink the cut edge so it reads even where the image behind is light.
        if (edgeWidth > 0) {
          ctx.save();
          ctx.globalCompositeOperation = "source-over";
          place();
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.lineWidth = edgeWidth / s;
          ctx.strokeStyle = edgeColor;
          ctx.stroke(letter);
          ctx.restore();
        }

        // The spiral can't fully clear by scale alone — dissolve what's left.
        ctx.canvas.style.opacity = String(
          1 - clamp01((reveal - fadeStart) / Math.max(1e-4, openEnd - fadeStart))
        );
      }
    },
    [
      mask,
      revealRef,
      openEnd,
      fadeStart,
      revealScaleMax,
      revealEase,
      fitFactor,
      edgeColor,
      edgeWidth,
      mc,
    ]
  );

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = parent.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    dimsRef.current = { w, h };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintMask(ctx, w, h);
  }, [paintMask]);

  const carveInk = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      r: number,
      seed: number,
      alpha: number
    ) => {
      const g = ctx.createRadialGradient(
        x, y, r * gradientInnerRadius,
        x, y, r
      );
      g.addColorStop(0, `rgba(0,0,0,${gradientStops[0] * alpha})`);
      g.addColorStop(0.5, `rgba(0,0,0,${gradientStops[1] * alpha})`);
      g.addColorStop(1, `rgba(0,0,0,${gradientStops[2] * alpha})`);
      ctx.fillStyle = g;

      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const wob =
          0.78 +
          wobble[0] * Math.sin(a * 3 + seed) +
          wobble[1] * Math.sin(a * 5 + seed * 2.1) +
          wobble[2] * Math.sin(a * 7 + seed * 0.7);
        const px = x + Math.cos(a) * r * wob;
        const py = y + Math.sin(a) * r * wob;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    },
    [segments, wobble, gradientInnerRadius, gradientStops]
  );

  const addStamp = useCallback(
    (x: number, y: number) => {
      const stamps = stampsRef.current;
      if (stamps.length >= maxStamps) stamps.shift();
      stamps.push({
        x,
        y,
        born: performance.now(),
        seed: Math.random() * Math.PI * 2,
        rmax: brushSize * (1 - rVary + Math.random() * rVary),
      });
    },
    [brushSize, rVary, maxStamps]
  );

  const stampAlong = useCallback(
    (x: number, y: number) => {
      const last = lastPosRef.current;
      if (!last) {
        addStamp(x, y);
      } else {
        const dx = x - last.x;
        const dy = y - last.y;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(dist / stampStep));
        for (let i = 1; i <= steps; i++) {
          addStamp(last.x + (dx * i) / steps, last.y + (dy * i) / steps);
        }
      }
      lastPosRef.current = { x, y };
    },
    [addStamp, stampStep]
  );

  const loop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = dimsRef.current;
    const now = performance.now();
    const stamps = stampsRef.current;

    paintMask(ctx, w, h);
    ctx.globalCompositeOperation = "destination-out";

    for (let i = stamps.length - 1; i >= 0; i--) {
      const age = now - stamps[i].born;
      if (age >= revealHold + lifetime) {
        stamps.splice(i, 1);
        continue;
      }

      // Grow to full radius quickly, then stay put.
      const grow = Math.min(1, age / expandTime);
      const ease = 1 - Math.pow(1 - grow, 3);
      const r = rStart + (stamps[i].rmax - rStart) * ease;

      // Stay fully open for `revealHold`, then heal over `lifetime`.
      let alpha = 1;
      if (age > revealHold) {
        const f = (age - revealHold) / lifetime;
        alpha = 1 - f * f;
      }

      carveInk(ctx, stamps[i].x, stamps[i].y, r, stamps[i].seed, alpha);
    }

    // A mask overlay keeps redrawing (scroll can change it at any time);
    // the plain fill only needs frames while ink stamps are alive.
    if (stamps.length || mask) {
      requestAnimationFrame(() => loopRef.current());
    } else {
      runningRef.current = false;
    }
  }, [paintMask, carveInk, mask, revealHold, lifetime, expandTime, rStart]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  const startLoop = useCallback(() => {
    if (!runningRef.current) {
      runningRef.current = true;
      requestAnimationFrame(() => loopRef.current());
    }
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // With a scroll-driven mask, keep a frame loop alive from mount.
  useEffect(() => {
    if (mask) startLoop();
  }, [mask, startLoop]);

  const getRelativePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        cursor: cursorInk ? "none" : undefined,
        pointerEvents: cursorInk ? undefined : "none",
        ...style,
      }}
      onMouseEnter={
        cursorInk
          ? (e) => {
              const pos = getRelativePos(e);
              lastPosRef.current = pos;
              stampAlong(pos.x, pos.y);
              startLoop();
            }
          : undefined
      }
      onMouseMove={
        cursorInk
          ? (e) => {
              const pos = getRelativePos(e);
              stampAlong(pos.x, pos.y);
              startLoop();
            }
          : undefined
      }
      onMouseLeave={
        cursorInk
          ? () => {
              lastPosRef.current = null;
            }
          : undefined
      }
    />
  );
}
