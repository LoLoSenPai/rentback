"use client";

import { useState } from "react";
import { shareDownloadPath, sharePostText, type ReclaimSharePayload } from "@/lib/share/reclaim-share";

export function ShareActions({ data }: { data: ReclaimSharePayload }) {
  const text = sharePostText(data);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const [copying, setCopying] = useState(false);
  const copied = copiedText === text;

  async function copyText() {
    setCopying(true);
    setCopiedText(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setManualCopy(false);
    } catch {
      setManualCopy(true);
    } finally {
      setCopying(false);
    }
  }

  return <div className="space-y-2">
    <div className="flex flex-wrap gap-3">
      <a href={shareDownloadPath(data)} download="rentback-reclaim.png" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rent-accent px-4 py-3 text-sm font-semibold text-slate-950">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" /></svg>
        Download image
      </a>
      <button type="button" onClick={() => void copyText()} disabled={copying} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rent-border px-4 py-3 text-sm text-slate-200 disabled:opacity-50">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></svg>
        {copying ? "Copying..." : copied ? "Copied" : "Copy text"}
      </button>
    </div>
    <p className="text-xs text-slate-400" aria-live="polite">{copied ? "Text copied. Attach the downloaded image when posting on X." : "Download the image, copy the text, then attach both to your post on X."}</p>
    {manualCopy && <label className="block space-y-2 text-xs text-slate-300">
      <span>Automatic copying is unavailable. Select and copy the text below.</span>
      <textarea readOnly value={text} rows={5} onFocus={(event) => event.currentTarget.select()} className="block w-full min-w-0 resize-y rounded-xl border border-rent-border bg-rent-bg p-3 text-sm leading-relaxed text-slate-200" />
    </label>}
  </div>;
}
