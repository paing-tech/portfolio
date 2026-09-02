"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import InkReveal from "@/components/InkReveal";
import { P_MASK } from "@/lib/pMask";
import heroBg from "@/app/assets/hero-bg.webp";

/** Mask overlay color — keep in sync with the section background so there is no seam. */
const MASK_COLOR: [number, number, number] = [252, 250, 248];

/**
 * Scroll length of the hero, in viewport heights. The P opens over the first
 * ~75% (see `openEnd` on <InkReveal>), the rest holds on the full image.
 */
const SCROLL_VH = 340;

export default function Hero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef(0);
  const [reduced, setReduced] = useState(false);

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
        gsap.set(imgRef.current, { scale: 1 });
        return;
      }

      revealRef.current = 0;
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
        },
      });

      // Hidden image settles from a slight zoom as the P opens.
      const tween = gsap.fromTo(
        imgRef.current,
        { scale: 1.15 },
        { scale: 1, ease: "none", scrollTrigger: range }
      );

      return () => {
        st.kill();
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    },
    { dependencies: [reduced], scope: wrapRef }
  );

  return (
    <section
      ref={wrapRef}
      className="relative w-full"
      style={{
        backgroundColor: `rgb(${MASK_COLOR.join(",")})`,
        height: reduced ? undefined : `${SCROLL_VH}vh`,
      }}
    >
      <div className="sticky top-0 h-svh w-full overflow-hidden">
        {/* Hidden image (z-0) — revealed through the growing P and the ink brush. */}
        <div ref={imgRef} className="absolute inset-0 will-change-transform">
          <Image
            src={heroBg}
            alt=""
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>

        {/* White plane with the P-hole + cursor ink reveal (canvas sets its own z-1). */}
        <InkReveal maskColor={MASK_COLOR} mask={P_MASK} revealRef={revealRef} />
      </div>
    </section>
  );
}
