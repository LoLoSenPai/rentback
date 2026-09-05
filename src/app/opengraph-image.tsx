import { ImageResponse } from "next/og";

export const alt = "RentBack - Reclaim excess SOL. No tokens burned. No accounts closed. 0% RentBack fee.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", background: "#0b1220", color: "#f8fafc", padding: "80px", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", color: "#56b6f7", fontSize: 32, marginBottom: 40 }}>RentBack</div>
    <div style={{ display: "flex", fontSize: 76, fontWeight: 700 }}>Reclaim excess SOL.</div>
    <div style={{ display: "flex", fontSize: 30, color: "#cbd5e1", marginTop: 30 }}>No tokens burned. No accounts closed.</div>
    <div style={{ display: "flex", fontSize: 28, color: "#56b6f7", marginTop: 40 }}>Free to scan. 0% RentBack fee.</div>
  </div>, size);
}
