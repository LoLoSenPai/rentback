import { NextResponse } from "next/server";
import { scanWalletRentProjection, toRentBackApiResult } from "@/lib/solana/scan";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { walletAddress?: string };
    const walletAddress = body?.walletAddress?.trim();

    if (!walletAddress || walletAddress.length === 0) {
      return NextResponse.json({ error: "walletAddress is required." }, { status: 400 });
    }

    const scan = await scanWalletRentProjection(walletAddress);
    return NextResponse.json(toRentBackApiResult(scan));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown scanner error";
    const status = message.includes("Invalid Solana address") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
