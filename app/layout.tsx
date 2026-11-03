import type { Metadata, Viewport } from "next";
import { Fraunces, Montserrat } from "next/font/google";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { DialogProvider } from "@/components/Dialogs";
import { getProfile } from "@/lib/store";
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

/** The signed-in user's light/dark choice; "system" (no attribute) follows the device. */
async function themeFor(): Promise<"light" | "dark" | undefined> {
  const session = await auth();
  if (!session?.user?.id) return undefined;
  const theme = await getProfile(session.user.id).then(
    (p) => p.settings.theme,
    () => "system" as const,
  );
  return theme === "system" ? undefined : theme;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set on the server, so the page never flashes the other theme first.
  const theme = await themeFor();
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`} data-theme={theme}>
      <body>
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
