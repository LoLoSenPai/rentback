import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "./wallet-provider";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "RentBack | Reclaim excess SOL",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  icons: { icon: "/rentback-icon.svg" },
  openGraph: { type: "website", url: SITE_URL, siteName: "RentBack", title: "RentBack | Reclaim excess SOL", description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: "RentBack | Reclaim excess SOL", description: SITE_DESCRIPTION, images: [`${SITE_URL}/opengraph-image`] },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
