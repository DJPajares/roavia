"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggle } from "./theme-toggle";

const navigation = [
  { href: "/", label: "Explore", symbol: "◒" },
  { href: "/trips", label: "Trips", symbol: "⌘" },
  { href: "/plan", label: "Plan", symbol: "↗" },
  { href: "/assistant", label: "Assistant", symbol: "◌" },
  { href: "/profile", label: "Profile", symbol: "◐" },
] as const;

function matchesPath(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

function Navigation({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={compact ? "Primary mobile" : "Primary"}
      className={compact ? "shell-nav shell-nav--compact" : "shell-nav"}
    >
      {navigation.map((item) => {
        const active = matchesPath(pathname, item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "shell-nav__link is-active" : "shell-nav__link"}
            href={item.href}
            key={item.href}
          >
            <span aria-hidden="true" className="shell-nav__symbol">
              {item.symbol}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="app-shell">
      <header className="mobile-topbar">
        <Link aria-label="Roavia home" className="wordmark" href="/">
          Roavia
        </Link>
        <ThemeToggle />
      </header>
      <aside aria-label="Application sidebar" className="desktop-rail">
        <Link aria-label="Roavia home" className="wordmark" href="/">
          Roavia
        </Link>
        <p className="desktop-rail__eyebrow">Travel intelligence</p>
        <Navigation />
        <div className="desktop-rail__footer">
          <ThemeToggle />
          <p>Plan with context. Move with confidence.</p>
        </div>
      </aside>
      <main className="app-content">{children}</main>
      <div className="mobile-nav">
        <Navigation compact />
      </div>
    </div>
  );
}
