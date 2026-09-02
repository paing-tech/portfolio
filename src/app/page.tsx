import Hero from "@/components/sections/Hero";

export default function Home() {
  return (
    <main className="flex-1">
      <Hero />

      {/* Placeholder for the next chapter — proves the hero releases into normal flow. */}
      <section className="relative z-10 grid min-h-svh place-items-center bg-neutral-950 text-neutral-500">
        <span className="text-xs uppercase tracking-[0.3em]">Next section</span>
      </section>
    </main>
  );
}
