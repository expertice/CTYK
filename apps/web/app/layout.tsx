import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getUiCopy } from "../lib/i18n/ui-copy";
import { AppHeader } from "../components/layout/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transcribator",
  description: "AI platform for OT/PB briefing analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const copy = getUiCopy("ru");

  return (
    <html lang="ru">
      <body>
        <AppHeader />
        <main className="app-main">{children}</main>
        <div className="app-floating-dock" aria-label="Быстрые действия">
          <Link href="/" className="app-fab" title={copy.home.floatingActions.homeAria} aria-label={copy.home.floatingActions.homeAria}>
            <svg className="app-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 22V12h6v10" />
            </svg>
          </Link>
          <Link
            href="/sessions/new"
            className="app-fab app-fab-accent"
            title={copy.home.floatingActions.newAria}
            aria-label={copy.home.floatingActions.newAria}
          >
            <svg className="app-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Link>
        </div>
      </body>
    </html>
  );
}
