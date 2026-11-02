import type { Metadata, Viewport } from "next";
import { Fraunces, Montserrat } from "next/font/google";
import type { ReactNode } from "react";
import { DialogProvider } from "@/components/Dialogs";
import "./globals.css";

// Self-hosted by next/font; globals.css uses it through --font-sans.
const sans = Montserrat({ subsets: ["latin"], variable: "--font-sans" });
// Headings: an editorial serif that gives trips a travel-magazine feel.
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "PlanAway",
  description: "Trip planning agent powered by Claude",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
