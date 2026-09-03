"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import InkReveal from "@/components/InkReveal";
import { P_MASK } from "@/lib/pMask";
import heroScene from "@/app/assets/hero.webp";
import zenChar from "@/app/assets/zen-full.webp";

/** Cream — shared by the P plane, the ink cover and the section background. */
const MASK_COLOR: [number, number, number] = [252, 250, 248];
const MASK_RGB = `rgb(${MASK_COLOR.join(",")})`;

/** Scroll length of the hero, in viewport heights. */
const SCROLL_VH = 340;

/** Progress past which the cursor ink-carve turns on (P mostly dissolved). */
const INK_FROM = 0.4;

export default function Hero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
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
        gsap.set(sceneRef.current, { scale: 1 });
        gsap.set(textRef.current, { autoAlpha: 1, y: 0 });
        return;
      }

      revealRef.current = 0;
      setInkOn(false);
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
        },
      });

      // Intro text lifts and fades over the first viewport of scroll.
      const textTween = gsap.fromTo(
        textRef.current,
        { autoAlpha: 1, y: 0 },
        {
          autoAlpha: 0,
          y: -60,
          ease: "none",
          scrollTrigger: {
            trigger: wrapRef.current,
            start: "top top",
            end: "+=90%",
            scrub: true,
          },
        }
      );

      // Scene settles from a slight zoom as the P opens.
      const sceneTween = gsap.fromTo(
        sceneRef.current,
        { scale: 1.12 },
        { scale: 1, ease: "none", scrollTrigger: range }
      );

      return () => {
        st.kill();
        textTween.scrollTrigger?.kill();
        textTween.kill();
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
            className="object-cover object-center"
          />
        </div>

        {/* z-20 — cream cover the cursor carves to reveal the scene.
            Skipped for reduced motion (scene just shows). */}
        {!reduced && (
          <InkReveal
            maskColor={MASK_COLOR}
            cursorInk={inkOn}
            style={{ zIndex: 20 }}
          />
        )}

        {/* z-30 — the character. Always on top of the ink cover, so the
            carve reveals the scene *around* it, never the character itself. */}
        <div className="pointer-events-none absolute inset-0 z-30">
          <Image
            src={zenChar}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>

        {/* z-40 — cream P plane + text, scroll-driven zoom & dissolve. No ink. */}
        <InkReveal
          maskColor={MASK_COLOR}
          mask={P_MASK}
          revealRef={revealRef}
          cursorInk={false}
          style={{ zIndex: 40 }}
        />

        {/* z-50 — intro text, never intercepts the pointer. */}
        <div ref={textRef} className="pointer-events-none absolute inset-0 z-50">
          <div
            className="absolute inset-x-0 bottom-0 h-2/3"
            style={{
              background: `linear-gradient(to top, ${MASK_RGB} 12%, rgba(252,250,248,0.72) 45%, transparent)`,
            }}
          />
          <div className="absolute bottom-8 left-8 max-w-[min(90vw,640px)] sm:bottom-12 sm:left-12 lg:bottom-16 lg:left-16">
            <p className="mb-3 text-[11px] uppercase tracking-[0.35em] text-neutral-500">
              Portfolio
            </p>
            <h1 className="text-[clamp(2.5rem,7vw,5.5rem)] font-medium leading-[0.95] tracking-tight text-neutral-900">
              Paing Thit Xan
            </h1>
            <p className="mt-4 max-w-[42ch] text-sm text-neutral-600 sm:text-base">
              Designer &amp; developer building interactive, scroll-driven
              experiences.
            </p>
          </div>
          <span className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-neutral-400">
            Scroll ↓
          </span>
        </div>
      </div>
    </section>
  );
}
