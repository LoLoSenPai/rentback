import { NextResponse } from "next/server";
import { mainnetReclaimRpc, prepareReclaim, readReclaimReceipt, submitReclaim } from "@/lib/solana/reclaim-server";
import type { ReclaimBatchDto, ReclaimReceipt } from "@/lib/solana/reclaim";
import { publicApiError } from "@/lib/api-safety";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin reclaim requests are not allowed." }, { status: 403 });
    const text = await request.text();
    if (text.length > 200_000) throw new Error("Request is too large.");
    const body = JSON.parse(text) as { action: string; owner: string; scannedWallet: string; candidates?: string[]; batch?: ReclaimBatchDto; wire?: string; receipt?: ReclaimReceipt };
    if (!body || !["prepare", "submit", "status"].includes(body.action)) throw new Error("Invalid reclaim action.");
    const rpc = await mainnetReclaimRpc();
    let result;
    if (body.action === "prepare") result = await prepareReclaim(rpc, body.owner, body.scannedWallet, body.candidates);
    else if (body.action === "submit" && body.batch && typeof body.wire === "string") result = { signature: await submitReclaim(rpc, body.owner, body.scannedWallet, body.batch, body.wire) };
    else if (body.action === "status" && body.receipt) result = await readReclaimReceipt(rpc, body.receipt);
    else throw new Error("Missing reclaim request fields.");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: publicApiError(cause, "Reclaim request could not be completed. Check transaction status before retrying.") }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
