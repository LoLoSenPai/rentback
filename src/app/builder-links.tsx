import { BUILDER, SOURCE_URL } from "@/lib/site";

const linkStyle = "inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-rent-border bg-rent-bg/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-rent-accent/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-rent-accent";
export function BuilderLinks() {
  return <div className="mt-5 space-y-5">
    <div className="flex flex-wrap gap-3">
      <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={linkStyle}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.3c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 5 18 5.3 18 5.3c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.5c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" /></svg>
        View source on GitHub
      </a>
      <a href={BUILDER.xUrl} target="_blank" rel="noopener noreferrer" className={linkStyle}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l4.4 6.7L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z" /></svg>
        Follow on X
      </a>
    </div>
    <p className="text-xs text-slate-400">Built by <a href={BUILDER.portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-slate-200 underline decoration-slate-600 underline-offset-4 hover:text-rent-accent">{BUILDER.name}</a></p>
  </div>;
}
