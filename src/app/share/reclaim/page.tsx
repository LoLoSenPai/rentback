import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { buildShareCardViewModel, parseShareSearchParams, shareImagePath, shareOnXUrl, sharePreviewPath, SHARE_SIZE } from "@/lib/share/reclaim-share";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
async function resultFromParams(props: Props) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await props.searchParams)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  return parseShareSearchParams(params);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  try {
    const data = await resultFromParams(props); const model = buildShareCardViewModel(data);
    const title = `${model.amount} SOL reclaimed | RentBack`;
    const description = `A shared RentBack result: ${model.accounts} token accounts processed. ${model.trust}`;
    const url = `${SITE_URL}${sharePreviewPath(data)}`;
    const image = { url: `${SITE_URL}${shareImagePath(data)}`, ...SHARE_SIZE, alt: `${model.amount} SOL reclaimed. ${model.accounts} ${model.accountLabel}. 0% RentBack fee.` };
    return { title, description, alternates: { canonical: url }, robots: { index: false, follow: false }, openGraph: { type: "website", title, description, url, siteName: "RentBack", images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
  } catch { return { title: "Invalid share | RentBack", robots: { index: false, follow: false } }; }
}

export default async function ReclaimSharePage(props: Props) {
  const data = await resultFromParams(props).catch(() => notFound());
  const model = buildShareCardViewModel(data);
  return <main className="min-h-screen bg-rent-bg px-4 py-12 text-slate-100">
    <div className="mx-auto max-w-5xl space-y-6">
      <a href={SITE_URL} className="text-lg font-semibold text-rent-accent">RentBack</a>
      <h1 className="text-2xl font-semibold">{model.amount} SOL reclaimed</h1>
      <Image src={shareImagePath(data)} width={SHARE_SIZE.width} height={SHARE_SIZE.height} unoptimized priority alt={`${model.amount} SOL reclaimed. ${model.accounts} ${model.accountLabel}. ${model.trust}`} className="h-auto w-full rounded-2xl border border-rent-border" />
      <div className="flex flex-wrap gap-3">
        <a href={shareOnXUrl(data)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-rent-accent px-5 py-3 text-sm font-semibold text-slate-950">Share on X</a>
        <a href={shareImagePath(data)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-rent-border px-5 py-3 text-sm">Open share image</a>
        <a href={SITE_URL} className="inline-flex min-h-11 items-center px-3 text-sm text-rent-accent underline">Check your wallet</a>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">User-shared result, not independent on-chain verification. Shared links are public and their parameters are editable. Network fees are separate from the 0% RentBack fee.</p>
      {!!data.confirmedSignatures?.length && <details className="text-sm text-slate-300"><summary className="cursor-pointer py-3">Transaction references</summary><ul className="space-y-3">{data.confirmedSignatures.map((signature, i) => <li key={signature}><a className="text-rent-accent underline" href={`https://explorer.solana.com/tx/${signature}`} target="_blank" rel="noopener noreferrer">View transaction {i + 1} on mainnet</a></li>)}</ul></details>}
    </div>
  </main>;
}
