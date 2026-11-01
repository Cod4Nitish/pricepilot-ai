import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import AppShell from "@/components/layout/AppShell";
import RegisterSW from "@/components/pwa/RegisterSW";
import InstallPrompt from "@/components/pwa/InstallPrompt";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display-var", display: "swap" });

export const metadata: Metadata = {
  title: { default: "PricePilot AI - Search Smarter. Compare Better. Pay Less.", template: "%s | PricePilot AI" },
  description:
    "AI-powered price comparison across Indian retailers. Every price is labelled with how it was verified.",
  manifest: "/manifest.webmanifest",
  applicationName: "PricePilot AI",
  appleWebApp: { capable: true, title: "PricePilot AI", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

const themeScript = `try{var t=localStorage.getItem('pricepilot:theme');if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
          <RegisterSW />
          <InstallPrompt />
        </Providers>
      </body>
    </html>
  );
}
