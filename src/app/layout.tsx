import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RentBack",
  description: "Scan token-account rent exemptions and view Solana SIMD-0437 projections.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
