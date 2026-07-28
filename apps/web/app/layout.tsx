import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";

// oxlint-disable-next-line import/no-unassigned-import
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Roavia",
    template: "%s · Roavia",
  },
  description: "Plan intelligently. Travel confidently.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
