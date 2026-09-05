import type { buildShareCardViewModel } from "./reclaim-share";

type CardModel = ReturnType<typeof buildShareCardViewModel>;

function AccountMotif() {
  return <svg width="230" height="220" viewBox="0 0 230 220" fill="none">
    <path d="M32 38H109M32 82H109M32 126H109M110 38V126M110 82H152" stroke="#56b6f7" strokeWidth="2" strokeDasharray="4 6" opacity="0.55" />
    {[20, 64, 108].map((y) => <g key={y}><rect x="4" y={y} width="66" height="32" rx="8" fill="#142c48" stroke="#34567b" /><rect x="15" y={y + 11} width="24" height="4" rx="2" fill="#64c8fc" /><circle cx="55" cy={y + 14} r="3" fill="#72e3da" /></g>)}
    <rect x="135" y="54" width="84" height="94" rx="20" fill="#163b57" stroke="#56b6f7" strokeWidth="2" />
    <rect x="180" y="86" width="46" height="30" rx="9" fill="#245571" stroke="#7cdcf3" />
    <circle cx="194" cy="101" r="4" fill="#9ef4e9" />
    <path d="M151 72H189" stroke="#8bbcd0" strokeWidth="3" strokeLinecap="round" />
    <circle cx="159" cy="164" r="24" fill="#58cbdf" />
    <path d="M149 164L156 171L170 157" stroke="#08283e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

// One bounded, data-driven composition for X and OG. No screenshot, remote
// image, wallet payload, transaction construction or arbitrary HTML is involved.
export function ReclaimCard({ model }: { model: CardModel }) {
  return <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", backgroundColor: "#080f21", backgroundImage: "radial-gradient(ellipse at 88% 24%, #133957 0%, #0c1a31 36%, #080f21 75%)", color: "#f0f7ff", fontFamily: "Barlow", padding: "44px 54px" }}>
    <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: 8, height: 630, background: "linear-gradient(180deg, #65dce9 0%, #3683c6 45%, #142641 100%)" }} />
    <div style={{ display: "flex", position: "absolute", right: -90, top: -155, width: 510, height: 510, border: "1px solid #3a769144", borderRadius: 255 }} />
    <div style={{ display: "flex", position: "absolute", right: -35, top: -100, width: 400, height: 400, border: "1px solid #3a769133", borderRadius: 200 }} />
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 50 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{ display: "flex", width: 42, height: 42, borderRadius: 12, border: "1px solid #36739b", backgroundColor: "#153753", alignItems: "center", justifyContent: "center", color: "#8be5ff", fontFamily: "Barlow Condensed", fontSize: 31 }}>R</div>
        <div style={{ display: "flex", fontSize: 30 }}>RentBack</div>
        <div style={{ display: "flex", marginLeft: 15, color: "#87a7c6", fontSize: 13, letterSpacing: 2 }}>SOLANA MAINNET</div>
      </div>
      <div style={{ display: "flex", border: "1px solid #3b7384", backgroundColor: "#163c4833", borderRadius: 30, padding: "11px 18px", alignItems: "center", gap: 9, fontSize: 14, letterSpacing: 1.4, color: "#9ce6e6" }}><div style={{ display: "flex", width: 6, height: 6, borderRadius: 3, backgroundColor: "#8ae2df" }} />{model.status}</div>
    </div>
    <div style={{ display: "flex", position: "absolute", right: 68, top: 165, opacity: 0.85 }}><AccountMotif /></div>
    <div style={{ display: "flex", marginTop: 47, fontSize: 16, letterSpacing: 2.5, color: "#7ba8cb" }}>EXCESS RENT. BACK IN YOUR WALLET.</div>
    <div style={{ display: "flex", alignItems: "baseline", marginTop: 8, height: 122, gap: 18 }}>
      <div style={{ display: "flex", fontFamily: "Barlow Condensed", fontSize: model.amountFontSize, letterSpacing: -1, lineHeight: 1.12 }}>{model.amount}</div>
      <div style={{ display: "flex", fontSize: 37, color: "#7cd7f8" }}>SOL</div>
    </div>
    <div style={{ display: "flex", fontSize: 34, color: "#c4e1f1", marginTop: -5 }}>reclaimed</div>
    <div style={{ display: "flex", marginTop: 17, height: 30, alignItems: "center", color: model.remaining ? "#85ddec" : "#819bb6", fontSize: 18 }}>
      {model.remaining ?? "Excess SOL reclaimed from overfunded token accounts."}
    </div>
    <div style={{ display: "flex", marginTop: 30, paddingTop: 22, borderTop: "1px solid #29405c", gap: 50, alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 250 }}><div style={{ display: "flex", fontFamily: "Barlow Condensed", fontSize: 39 }}>{model.accounts}</div><div style={{ display: "flex", fontSize: 17, color: "#a6b8cc" }}>{model.accountLabel}</div></div>
      {model.transactions && <div style={{ display: "flex", flexDirection: "column", minWidth: 240 }}><div style={{ display: "flex", fontFamily: "Barlow Condensed", fontSize: 39 }}>{model.transactions}</div><div style={{ display: "flex", fontSize: 17, color: "#a6b8cc" }}>{model.transactionLabel}</div></div>}
      <div style={{ display: "flex", flexDirection: "column" }}><div style={{ display: "flex", fontFamily: "Barlow Condensed", fontSize: 39, color: "#8ce5e9" }}>{model.fee}</div><div style={{ display: "flex", fontSize: 17, color: "#a6b8cc" }}>RentBack fee</div></div>
      {(model.walletShort || model.date) && <div style={{ display: "flex", flexDirection: "column", marginLeft: "auto", gap: 7, fontSize: 14, color: "#86a4bf" }}><div style={{ display: "flex" }}>{model.walletShort ?? ""}</div><div style={{ display: "flex" }}>{model.date ?? ""}</div></div>}
    </div>
    <div style={{ display: "flex", position: "absolute", left: 54, right: 54, bottom: 28, justifyContent: "space-between", alignItems: "center", paddingTop: 20, borderTop: "1px solid #29405c", fontSize: 17 }}><div style={{ display: "flex", color: "#a9bfd5" }}>{model.trust}</div><div style={{ display: "flex", color: "#70caef" }}>{model.productHost}</div></div>
  </div>;
}
