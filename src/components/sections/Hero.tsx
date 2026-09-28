"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import InkReveal from "@/components/InkReveal";
import HeroStats from "@/components/sections/HeroStats";
import { P_MASK } from "@/lib/pMask";
import heroScene from "@/app/assets/hero.webp";
import zenChar from "@/app/assets/zen-full.webp";

/** Cream — shared by the P plane, the ink cover and the section background. */
const MASK_COLOR: [number, number, number] = [255, 255, 255];
const MASK_RGB = `rgb(${MASK_COLOR.join(",")})`;

/** Scroll length of the hero, in viewport heights. */
const SCROLL_VH = 340;

/** Progress past which the cursor ink-carve turns on (P mostly zoomed through). */
const INK_FROM = 0.4;

/** Progress at which the P has finished opening (keep in step with InkReveal `openEnd`). */
const P_OPEN_END = 0.72;

/** Character scale: while the P is on screen → after the zoom-through. */
const ZEN_SCALE_IN = 0.7;
const ZEN_SCALE_OUT = 0.85;

/** Progress by which the name + stats have faded out — they live on the P plane only. */
const UI_FADE_END = 0.06;

export default function Hero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const zenRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef(0);
  const [reduced, setReduced] = useState(false);
  const [inkOn, setInkOn] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useGSAP(
    () => {
      if (reduced) {
        revealRef.current = 1;
        gsap.set(sceneRef.current, { scale: 0.95 });
        gsap.set(zenRef.current, { scale: ZEN_SCALE_OUT });
        // P starts fully open here, so there's no plane for the UI to sit on.
        gsap.set(uiRef.current, { autoAlpha: 0 });
        return;
      }

      revealRef.current = 0;
      setInkOn(false);
      gsap.set(zenRef.current, { scale: ZEN_SCALE_IN });
      gsap.set(uiRef.current, { autoAlpha: 1 });
      const range = {
        trigger: wrapRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: true as const,
      };

      const st = ScrollTrigger.create({
        ...range,
        onUpdate: (self) => {
          revealRef.current = self.progress;
          setInkOn(self.progress > INK_FROM);
          // Character grows from its "in the P" size to its "after zoom" size,
          // reaching the latter as the P finishes opening.
          const t = gsap.utils.clamp(0, 1, self.progress / P_OPEN_END);
          gsap.set(zenRef.current, {
            scale: gsap.utils.interpolate(ZEN_SCALE_IN, ZEN_SCALE_OUT, t),
          });
          // Name + stats fade out as soon as the P starts zooming.
          gsap.set(uiRef.current, {
            autoAlpha: 1 - gsap.utils.clamp(0, 1, self.progress / UI_FADE_END),
          });
        },
      });

      // Scene settles from a slight zoom as the P opens.
      const sceneTween = gsap.fromTo(
        sceneRef.current,
        { scale: 0.8 },
        { scale: 0.9, ease: "none", scrollTrigger: range }
      );

      return () => {
        st.kill();
        sceneTween.scrollTrigger?.kill();
        sceneTween.kill();
      };
    },
    { dependencies: [reduced], scope: wrapRef }
  );

  return (
    <section
      ref={wrapRef}
      className="relative w-full"
      style={{
        backgroundColor: MASK_RGB,
        height: reduced ? undefined : `${SCROLL_VH}vh`,
      }}
    >
      <div className="sticky top-0 h-svh w-full overflow-hidden">
        {/* z-10 — the scene, hidden until carved away by the ink cover. */}
        <div ref={sceneRef} className="absolute inset-0 z-10 will-change-transform">
          <Image
            src={heroScene}
            alt=""
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            className="object-contain object-center"
          />
        </div>

        {/* z-20 — cream cover the cursor carves to reveal the scene.
            Skipped for reduced motion (scene just shows). */}
        {!reduced && (
          <InkReveal
            maskColor={[105, 105, 105]}
            cursorInk={inkOn}
            style={{ zIndex: 20 }}
          />
        )}

        {/* z-30 — the character. Always on top of the ink cover, so the
            carve reveals the scene *around* it, never the character itself. */}
        <div
          ref={zenRef}
          className="pointer-events-none absolute inset-0 z-30 will-change-transform"
        >
          <Image
            src={zenChar}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-contain object-center"
          />
        </div>

        {/* z-40 — cream P plane, scroll-driven zoom-through. No ink, no text. */}
        <InkReveal
          maskColor={MASK_COLOR}
          mask={P_MASK}
          revealRef={revealRef}
          cursorInk={false}
          fitFactor={0.5}
          revealScaleMax={35}
          revealSpin={45}
          style={{ zIndex: 40 }}
        />

        {/* z-50 — UI on the P plane; fades out as the P zooms through. */}
        <div ref={uiRef} className="pointer-events-none absolute inset-0 z-50">
          {/* Name. Mobile: centred just below the P (P is width-bound there, its
              half-height ≈ 34vw). Desktop: pinned to the bottom-left corner. */}
          <div className="absolute inset-x-0 top-[calc(50%+36vw+1.5rem)] text-center text-[#000000] md:inset-x-auto md:top-auto md:bottom-10 md:left-10 md:text-left">
            <h1 className="font-sans text-2xl font-medium tracking-tight md:text-4xl">
              Paing Thit Xan
            </h1>
          </div>

          {/* Stats. Mobile: spread along the bottom. Desktop: bottom-right corner. */}
          <HeroStats className="absolute inset-x-4 bottom-8 justify-between text-center md:inset-x-auto md:right-10 md:bottom-10 md:justify-end" />
        </div>
      </div>
    </section>
  );
}
