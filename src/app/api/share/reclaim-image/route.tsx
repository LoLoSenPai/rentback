import { ImageResponse } from "next/og";
import { ReclaimCard } from "@/lib/share/reclaim-card";
import { buildShareCardViewModel, InvalidSharePayload, parseShareSearchParams, SHARE_SIZE } from "@/lib/share/reclaim-share";
import { loadShareFonts } from "@/lib/share/share-fonts";
import { ScanLimiter, scanClientKey } from "@/lib/scan-limit";

export const runtime = "nodejs";
const imageLimiter = new ScanLimiter(); // Separate budget from public wallet scans.

export async function GET(request: Request) {
  let release: (() => void) | undefined;
  try {
    const params = new URL(request.url).searchParams;
    const download = params.has("download");
    if (download && (params.getAll("download").length !== 1 || params.get("download") !== "1")) throw new InvalidSharePayload();
    params.delete("download");
    const model = buildShareCardViewModel(parseShareSearchParams(params));
    release = imageLimiter.acquire(scanClientKey(request)) ?? undefined;
    if (!release) return new Response("Too many image requests. Please retry shortly.", { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    const image = new ImageResponse(<ReclaimCard model={model} />, { ...SHARE_SIZE, fonts: await loadShareFonts() });
    const png = await image.arrayBuffer();
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, s-maxage=86400", "X-Content-Type-Options": "nosniff", ...(download ? { "Content-Disposition": 'attachment; filename="rentback-reclaim.png"' } : {}) } });
  } catch (error) {
    return new Response(error instanceof InvalidSharePayload ? error.message : "Unable to render the share card.", { status: error instanceof InvalidSharePayload ? 400 : 500, headers: { "Cache-Control": "no-store" } });
  } finally { release?.(); }
}
