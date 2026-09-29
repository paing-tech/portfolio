"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import InkReveal from "@/components/InkReveal";
import Rift, { type RiftHandle } from "@/components/Rift";
import HeroStats from "@/components/sections/HeroStats";
import HeroSocials from "@/components/sections/HeroSocials";
import { TextMarquee } from "@/components/ui/TextMarquee";
import { P_MASK } from "@/lib/pMask";
import { useVisitorNumber } from "@/lib/visits";
import heroScene from "@/app/assets/hero.webp";
import zenChar from "@/app/assets/zen-full.webp";

/** Cream — shared by the P plane, the ink cover and the section background. */
const MASK_COLOR: [number, number, number] = [255, 255, 255];
const MASK_RGB = `rgb(${MASK_COLOR.join(",")})`;

/** Scroll length of the P zoom-through, in viewport heights. */
const SCROLL_VH = 340;

/** Extra scroll after the P for the dimensional rift to tear open, in viewport heights. */
const RIFT_VH = 220;

/** The next scene, revealed through the rift. */
const RIFT_WORLD = (
  <Image src="/exhibition.png" alt="" fill sizes="100vw" className="object-cover object-center" />
);

/** Progress past which the cursor ink-carve turns on (P mostly zoomed through). */
const INK_FROM = 0.4;

/** Progress at which the P has finished opening (keep in step with InkReveal `openEnd`). */
const P_OPEN_END = 0.72;

/** Character scale: while the P is on screen → after the zoom-through. */
const ZEN_SCALE_IN = 0.7;
const ZEN_SCALE_OUT = 0.85;

/** Roles scrolling beneath the name. */
const ROLES = ["AI Engineer", "Software Engineer", "Full-stack Developer"];

/** P zoom curve — passed to InkReveal, and reused so the UI rides the same zoom. */
const P_SCALE_MAX = 35;
const P_EASE = 3.2;

/** Scale of the P plane at a given scroll progress (mirrors InkReveal's paintMask). */
const planeScale = (progress: number) => {
  const openT = gsap.utils.clamp(0, 1, progress / P_OPEN_END);
  return 1 + (P_SCALE_MAX - 1) * Math.pow(openT, P_EASE);
};

export default function Hero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const zenRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);
  const pZoneRef = useRef<HTMLDivElement>(null);
  const riftZoneRef = useRef<HTMLDivElement>(null);
  const riftRef = useRef<RiftHandle>(null);
  const revealRef = useRef(0);
  const [reduced, setReduced] = useState(false);
  const [inkOn, setInkOn] = useState(false);
  // Mountain-scene toggle: offered from the P opening until the rift starts. Its
  // state carries through the rift; it resets once the P is back.
  const [pOpen, setPOpen] = useState(false);
  const [riftStarted, setRiftStarted] = useState(false);
  const [sceneShown, setSceneShown] = useState(false);
  const toggleReady = !reduced && pOpen && !riftStarted;

  // Records the visit so the count stays accurate; not displayed yet
  // (returns this visitor's number for a future "You're the Nth visitor").
  useVisitorNumber();

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
      gsap.set(coverRef.current, { filter: "invert(0)" });
      gsap.set(uiRef.current, { autoAlpha: 1 });
      const range = {
        trigger: pZoneRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: true as const,
      };

      const st = ScrollTrigger.create({
        ...range,
        onUpdate: (self) => {
          revealRef.current = self.progress;
          setInkOn(self.progress > INK_FROM);
          setPOpen(self.progress >= P_OPEN_END);
          // Back on the P-covered landing view → mountains hidden again.
          if (self.progress < P_OPEN_END) setSceneShown(false);
          // Character grows from its "in the P" size to its "after zoom" size,
          // reaching the latter as the P finishes opening.
          const t = gsap.utils.clamp(0, 1, self.progress / P_OPEN_END);
          gsap.set(zenRef.current, {
            scale: gsap.utils.interpolate(ZEN_SCALE_IN, ZEN_SCALE_OUT, t),
          });
          // Ink cover: black at rest → white once the P has fully opened.
          gsap.set(coverRef.current, { filter: `invert(${t})` });
          // UI is "printed" on the P plane: each piece is pushed away from the
          // screen centre as the plane scales (logos up, name + stats down).
          const ui = uiRef.current;
          if (ui) {
            const grow = planeScale(self.progress) - 1;
            const midY = ui.clientHeight / 2;
            const els = ui.querySelectorAll<HTMLElement>("[data-drift]");
            // Read every offset before writing any transform (no layout thrash).
            const dists = Array.from(els, (el) => el.offsetTop + el.offsetHeight / 2 - midY);
            els.forEach((el, i) => gsap.set(el, { y: dists[i] * grow }));
            // Off-screen once the P is open — keep the links out of the tab order.
            gsap.set(ui, { visibility: self.progress >= P_OPEN_END ? "hidden" : "visible" });
          }
        },
      });

      // Scene settles from a slight zoom as the P opens.
      const sceneTween = gsap.fromTo(
        sceneRef.current,
        { scale: 0.8 },
        { scale: 0.9, ease: "none", scrollTrigger: range }
      );

      // Rift: tears open over the scroll that follows the P.
      const riftSt = ScrollTrigger.create({
        trigger: riftZoneRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (self) => {
          riftRef.current?.update(self.progress);
          setRiftStarted(self.progress > 0.01);
        },
      });
      riftRef.current?.update(riftSt.progress);

      return () => {
        st.kill();
        riftSt.kill();
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
        height: reduced ? undefined : `${SCROLL_VH + RIFT_VH}vh`,
      }}
    >
      {/* Scroll zones (layout-free markers): the P zoom, then the rift. The rift
          zone starts where the P's scroll ends, so the two play back to back. */}
      {!reduced && (
        <>
          <div
            ref={pZoneRef}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ height: `${SCROLL_VH}vh` }}
          />
          <div
            ref={riftZoneRef}
            aria-hidden
            className="pointer-events-none absolute inset-x-0"
            style={{ top: `${SCROLL_VH - 100}vh`, height: `${RIFT_VH + 100}vh` }}
          />
        </>
      )}
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

        {/* z-20 — ink cover the cursor carves to reveal the scene. Painted black;
            the wrapper's invert() filter fades it to white as the P opens.
            Skipped for reduced motion (scene just shows). */}
        {!reduced && (
          <div
            ref={coverRef}
            className="absolute inset-0 z-20 transition-opacity duration-700 ease-out will-change-[filter]"
            // Fades away entirely while the mountain toggle is on.
            style={{ opacity: sceneShown ? 0 : 1 }}
          >
            <InkReveal maskColor={[0, 0, 0]} cursorInk={inkOn} />
          </div>
        )}

        {/* z-25 — dimensional rift to the next world; the character stays in front. */}
        {!reduced && (
          <Rift ref={riftRef} className="z-[25]">
            {RIFT_WORLD}
          </Rift>
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
          revealScaleMax={P_SCALE_MAX}
          revealEase={P_EASE}
          revealSpin={45}
          // Light inner glow — a dark shadow would vanish against the black cover.
          holeShadowColor="rgba(255, 255, 255, 0.8)"
          holeShadowSize={60}
          style={{ zIndex: 40 }}
        />

        {/* z-50 — UI on the P plane; each [data-drift] piece moves off-screen
            with the zoom (see onUpdate). */}
        <div ref={uiRef} className="pointer-events-none absolute inset-0 z-50">
          {/* Contact links, top-centre. */}
          <div data-drift className="absolute inset-x-0 top-8 flex justify-center md:top-10">
            <HeroSocials />
          </div>

          {/* Name. Mobile: centred just below the P (P is width-bound there, its
              half-height ≈ 34vw). Desktop: pinned to the bottom-left corner. */}
          <div data-drift className="absolute inset-x-0 top-[calc(50%+36vw+1.5rem)] text-center text-[#000000] md:inset-x-auto md:top-auto md:bottom-10 md:left-10 md:text-left">
            <h1 className="font-sans text-3xl font-medium tracking-tight md:text-4xl">
              Paing Thit Xan
            </h1>
            <TextMarquee height={48} hold={2.5} slide={0.6} className="justify-center md:justify-start">
              {ROLES.map((role) => (
                <span
                  key={role}
                  className="w-full whitespace-nowrap text-center text-2xl font-medium tracking-tight md:text-left md:text-3xl"
                >
                  {role}
                </span>
              ))}
            </TextMarquee>
          </div>

          {/* Stats. Mobile: spread along the bottom. Desktop: bottom-right corner. */}
          <div data-drift className="absolute inset-x-4 bottom-8 md:inset-x-auto md:right-10 md:bottom-10">
            <HeroStats className="text-center md:justify-end" />
          </div>
        </div>

        {/* z-50 — mountain toggle (top-right): a thumbnail of the scene that reveals or hides it. */}
        <div
          className={`absolute top-6 right-6 z-50 transition-[opacity,visibility] duration-300 md:top-10 md:right-10 ${
            toggleReady ? "visible opacity-100" : "invisible opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={() => setSceneShown((v) => !v)}
            aria-pressed={sceneShown}
            aria-label={sceneShown ? "Hide mountain background" : "Show mountain background"}
            className="block cursor-pointer rounded-lg bg-white p-1.5 transition-transform duration-200 ease-out hover:scale-130 focus-visible:scale-130 motion-safe:hover:animate-jiggle motion-safe:focus-visible:animate-jiggle"
          >
            <span className="relative block h-12 w-[4.5rem] md:h-14 md:w-20">
              <Image
                src={heroScene}
                alt=""
                fill
                sizes="80px"
                className={`object-contain transition-opacity duration-300 ${
                  sceneShown ? "opacity-100" : "opacity-35"
                }`}
              />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
