import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Safe to call repeatedly; guarded so it only touches the browser build.
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };
