"use client";

import { CountingNumber } from "@/components/ui/CountingNumber";
import { cn } from "@/lib/utils";

const STATS = [
  { value: 1, suffix: "+", label: "Years Experience" },
  { value: 12, label: "Projects" },
  { value: 5, label: "Awards" },
] as const;

const numberClass = "block text-2xl font-medium tracking-tight md:text-4xl";
const labelClass = "mt-1 block text-xs leading-tight text-neutral-600 md:text-sm";

export default function HeroStats({ className }: { className?: string }) {
  return (
    <dl className={cn("grid grid-cols-3 gap-4 text-[#000000] md:flex md:gap-12", className)}>
      {STATS.map((s, i) => (
        <div key={s.label} className="flex flex-col-reverse">
          <dt className={labelClass}>{s.label}</dt>
          <dd>
            <CountingNumber
              value={s.value}
              suffix={"suffix" in s ? s.suffix : ""}
              delay={i * 0.1}
              className={numberClass}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
