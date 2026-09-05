import { NextResponse } from "next/server";
import { scanWalletRentProjection, toRentBackApiResult } from "@/lib/solana/scan";
import { isAddress } from "@solana/kit";
import { PublicApiError, publicApiError, readSmallJson } from "@/lib/api-safety";
import { scanClientKey, scanLimiter } from "@/lib/scan-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const release = scanLimiter.acquire(scanClientKey(request));
  const headers = { "Cache-Control": "no-store" };
  if (!release) return NextResponse.json({ error: "Too many scans. Please try again in one minute." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  try {
    const body = (await readSmallJson(request)) as { walletAddress?: unknown } | null;
    const walletAddress = typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";

    if (!walletAddress || walletAddress.length === 0) {
      throw new PublicApiError("walletAddress is required.");
    }
    if (!isAddress(walletAddress)) throw new PublicApiError("Invalid Solana address.");

    const scan = await scanWalletRentProjection(walletAddress);
    return NextResponse.json(toRentBackApiResult(scan), { headers });
  } catch (err) {
    const message = publicApiError(err, "The Solana RPC service could not complete this scan. Please try again.");
    return NextResponse.json({ error: message }, { status: err instanceof PublicApiError ? err.status : 500, headers });
  } finally { release(); }
}
