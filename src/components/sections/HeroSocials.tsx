import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Icons are trimmed to their artwork; w/h are intrinsic px so they share one height.
 * `size` overrides the default height for optical balance (the wide M reads heavier).
 */
const LINKS: {
  label: string;
  href: string;
  icon: string;
  w: number;
  h: number;
  size?: string;
}[] = [
  { label: "LinkedIn", href: "https://linkedin.com/in/paingthitxan", icon: "/linkedin.png", w: 410, h: 410 },
  { label: "GitHub", href: "https://github.com/paing-tech", icon: "/github.png", w: 398, h: 439 },
  { label: "Email", href: "mailto:paingthit.xan@gmail.com", icon: "/gmail.png", w: 683, h: 513, size: "h-5 md:h-6" },
];

export default function HeroSocials({ className }: { className?: string }) {
  return (
    <nav aria-label="Contact" className={cn("flex items-center gap-6", className)}>
      {LINKS.map(({ label, href, icon, w, h, size }) => {
        const external = href.startsWith("http");
        return (
          <a
            key={label}
            href={href}
            aria-label={label}
            {...(external && { target: "_blank", rel: "noopener noreferrer" })}
            className="pointer-events-auto block transition-opacity hover:opacity-60 focus-visible:opacity-60"
          >
            <Image src={icon} alt="" width={w} height={h} className={cn("w-auto", size ?? "h-6 md:h-7")} />
          </a>
        );
      })}
    </nav>
  );
}
