import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import { PwaRegistration } from "../components/pwa-registration";

// oxlint-disable-next-line import/no-unassigned-import
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Roavia",
    template: "%s · Roavia",
  },
  description: "Plan intelligently. Travel confidently.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#f4f1e8", media: "(prefers-color-scheme: light)" },
    { color: "#122421", media: "(prefers-color-scheme: dark)" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaRegistration />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
