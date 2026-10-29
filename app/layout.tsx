import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DialogProvider } from "@/components/Dialogs";
import "./globals.css";

export const metadata: Metadata = {
  title: "PlanAway",
  description: "Trip planning agent powered by Claude",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
