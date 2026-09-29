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

/**
 * The next scene, revealed through the rift: a portrait image under 768px wide
 * (the same breakpoint as `isMobile`), landscape otherwise. The hidden one isn't
 * downloaded (lazy images skip display: none).
 */
const RIFT_WORLD = (
  <>
    <Image src="/exhibition-mobile.png" alt="" fill sizes="100vw" className="object-cover object-center md:hidden" />
    <Image src="/exhibition.png" alt="" fill sizes="100vw" className="hidden object-cover object-center md:block" />
  </>
);

/** Progress past which the cursor ink-carve turns on (P mostly zoomed through). */
const INK_FROM = 0.4;

/** Progress at which the P has finished opening (keep in step with InkReveal `openEnd`). */
const P_OPEN_END = 0.72;

/**
 * Sizes of the character and the mountain scene, for desktop and phones
 * (screens under 768px wide). `in` = while inside the P hole on the landing view,
 * `out` = after the P has zoomed through. 1 = the art fitted to the screen width.
 */
const ZEN_SCALE = {
  desktop: { in: 0.7, out: 0.85 },
  mobile: { in: 1.3, out: 1.5 },
};
const SCENE_SCALE = {
  desktop: { in: 0.8, out: 0.9 },
  mobile: { in: 1.4, out: 1.6 },
};
const isMobile = () => window.innerWidth < 768;

/** Landing spot in each hall image (px size + normalised spot): the floor circle's front edge. */
const STAGE = {
  desktop: { x: 0.5, y: 0.7, w: 1920, h: 1080 }, // exhibition.png
  mobile: { x: 0.5, y: 0.6, w: 941, h: 1672 }, // exhibition-mobile.png
};
/** Character art in zen-full.webp (3840×2675): feet line, height and width, normalised. */
const ZEN_ART = { w: 3840, h: 2675, feet: 0.8187, height: 0.5114, width: 0.2817 };
/** Character height on the stage, as a fraction of the hall image's on-screen height. */
const STAGE_HEIGHT = { desktop: 0.35, mobile: 0.24 };
/**
 * Hall size, scaled about the screen centre on top of filling the screen
 * (object-cover). Keep ≥ 1, or empty bars show at the edges.
 */
const HALL_SCALE = { desktop: 1, mobile: 1 };
/** Rift progress over which the character walks into the hall: it waits until the
 *  tear has run corner to corner (≈0.2), then walks in quickly. */
const WALK_FROM = 0.2;
const WALK_TO = 0.3;

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
  const hallRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
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
        const size = isMobile() ? "mobile" : "desktop";
        gsap.set(sceneRef.current, { scale: SCENE_SCALE[size].out });
        gsap.set(zenRef.current, { scale: ZEN_SCALE[size].out });
        // P starts fully open here, so there's no plane for the UI to sit on.
        gsap.set(uiRef.current, { autoAlpha: 0 });
        return;
      }

      revealRef.current = 0;
      setInkOn(false);

      // The character (and the scene's scale) are driven by both zones, so they're
      // placed from one function: P zoom → grows to its "after zoom" size; rift →
      // shrinks and walks up until its feet stand on the hall's floor circle.
      let pProg = 0;
      let riftProg = 0;
      const placeZen = () => {
        const zen = zenRef.current;
        const shadow = shadowRef.current;
        if (!zen) return;
        const W = zen.clientWidth;
        const H = zen.clientHeight;

        const tP = gsap.utils.clamp(0, 1, pProg / P_OPEN_END);
        const size = isMobile() ? "mobile" : "desktop";
        const sOut = gsap.utils.interpolate(ZEN_SCALE[size].in, ZEN_SCALE[size].out, tP);
        // Scene settles from a slight zoom as the P opens.
        gsap.set(sceneRef.current, {
          scale: gsap.utils.interpolate(SCENE_SCALE[size].in, SCENE_SCALE[size].out, pProg),
        });
        const walk = gsap.utils.clamp(0, 1, (riftProg - WALK_FROM) / (WALK_TO - WALK_FROM));
        const tR = walk * walk * (3 - 2 * walk); // ease-in-out: sets off and settles smoothly

        // Character art is object-contain in the full layer; scaled about its centre.
        const fit = Math.min(W / ZEN_ART.w, H / ZEN_ART.h);
        const artH = ZEN_ART.h * fit;
        const feetLocal = (H - artH) / 2 + ZEN_ART.feet * artH;
        // Hall is object-cover, then scaled about the centre by HALL_SCALE: where
        // its floor circle lands on this screen.
        gsap.set(hallRef.current, { scale: HALL_SCALE[size] });
        const stage = STAGE[size];
        const cover = Math.max(W / stage.w, H / stage.h) * HALL_SCALE[size];
        const hallH = stage.h * cover;
        const stageY = (H - hallH) / 2 + stage.y * hallH;
        const sEnd = (STAGE_HEIGHT[size] * hallH) / (ZEN_ART.height * artH);
        const yEnd = stageY - (H / 2 + (feetLocal - H / 2) * sEnd);

        const scale = gsap.utils.interpolate(sOut, sEnd, tR);
        const y = yEnd * tR;
        gsap.set(zen, { scale, y });

        // Soft contact shadow under the feet, fading in as it lands.
        if (shadow) {
          const feetY = H / 2 + (feetLocal - H / 2) * scale + y;
          const sw = ZEN_ART.width * ZEN_ART.w * fit * scale * 0.8;
          gsap.set(shadow, {
            x: W * stage.x - sw / 2,
            y: feetY - sw * 0.09,
            width: sw,
            height: sw * 0.18,
            opacity: tR,
          });
        }
      };
      const onResize = () => placeZen();
      window.addEventListener("resize", onResize);
      placeZen();

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
          pProg = self.progress;
          placeZen();
          const t = gsap.utils.clamp(0, 1, self.progress / P_OPEN_END);
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

      // Rift: tears open over the scroll that follows the P.
      const riftSt = ScrollTrigger.create({
        trigger: riftZoneRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (self) => {
          riftRef.current?.update(self.progress);
          setRiftStarted(self.progress > 0.01);
          riftProg = self.progress;
          placeZen();
        },
      });
      riftRef.current?.update(riftSt.progress);

      return () => {
        window.removeEventListener("resize", onResize);
        st.kill();
        riftSt.kill();
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
            {/* Carving stops once the rift starts: it would repaint this full-screen
                canvas on every touch-scroll frame for an area the rift covers. */}
            <InkReveal maskColor={[0, 0, 0]} cursorInk={inkOn && !riftStarted} />
          </div>
        )}

        {/* z-25 — dimensional rift to the next world; the character stays in front. */}
        {!reduced && (
          <Rift ref={riftRef} className="z-[25]">
            <div ref={hallRef} className="absolute inset-0">
              {RIFT_WORLD}
            </div>
          </Rift>
        )}

        {/* z-29 — contact shadow for the character once it stands in the hall. */}
        {!reduced && (
          <div
            ref={shadowRef}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 z-[29] rounded-[50%]"
            style={{
              opacity: 0,
              background: "radial-gradient(closest-side, rgba(45, 35, 70, 0.32), rgba(45, 35, 70, 0))",
            }}
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
