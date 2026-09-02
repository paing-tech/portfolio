import InkReveal from "@/components/InkReveal";

/** Mask overlay color — keep in sync with the section background so there is no seam. */
const MASK_COLOR: [number, number, number] = [252, 250, 248];

export default function Hero() {
  return (
    <section
      className="relative h-dvh w-full overflow-hidden"
      style={{ backgroundColor: `rgb(${MASK_COLOR.join(",")})` }}
    >
      {/* ── Revealed layer (z-0) ───────────────────────────────
          Sits behind the ink mask and is uncovered as the cursor moves.
          TODO: drop the hidden <Image /> in here later. */}
      <div className="absolute inset-0 z-0 grid place-items-center bg-neutral-950 text-neutral-50">
        {/*
        <Image
          src="/hero.jpg"
          alt=""
          fill
          priority
          className="object-cover"
        />
        */}
        <div className="px-6 text-center">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-neutral-400">
            Portfolio
          </p>
          <h1 className="text-[clamp(2.5rem,9vw,8rem)] font-semibold leading-[0.95] tracking-tight">
            Paing Thit Xan
          </h1>
          <p className="mt-5 text-sm text-neutral-400 sm:text-base">
            Designer &amp; Developer — interactive experiences
          </p>
        </div>
      </div>

      {/* ── Ink mask (sets its own z-1) ──────────────────────── */}
      <InkReveal maskColor={MASK_COLOR} />

      {/* ── Foreground hint (z-10, never intercepts the cursor) ── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center">
        <span className="text-xs uppercase tracking-[0.3em] text-neutral-500 mix-blend-difference">
          Move your cursor
        </span>
      </div>
    </section>
  );
}
