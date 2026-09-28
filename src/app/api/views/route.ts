import { Redis } from "@upstash/redis";

/** Landing-page view counter, stored in Upstash Redis. */
const KEY = "portfolio:views";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const NO_STORE = { "Cache-Control": "no-store" };

function unavailable() {
  return Response.json({ views: null }, { status: 503, headers: NO_STORE });
}

/** Read the current count without incrementing. */
export async function GET() {
  if (!redis) return unavailable();
  try {
    const views = (await redis.get<number>(KEY)) ?? 0;
    return Response.json({ views }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

/** Record one view and return the new count. */
export async function POST() {
  if (!redis) return unavailable();
  try {
    const views = await redis.incr(KEY);
    return Response.json({ views }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
