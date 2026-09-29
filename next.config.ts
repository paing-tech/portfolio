import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let other devices on the local network (e.g. a phone) load the dev server.
  // Dev-only; it has no effect on production builds.
  allowedDevOrigins: ["192.168.88.9", "192.168.*.*"],
};

export default nextConfig;
