"use client";

import { useEffect, useState } from "react";

const storageKey = "roavia-theme";

function readTheme() {
  if (typeof window === "undefined") return false;
  const savedTheme = window.localStorage.getItem(storageKey);
  return (
    savedTheme === "dark" ||
    (savedTheme === null && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const initialTheme = readTheme();
    setIsDark(initialTheme);
    document.documentElement.classList.toggle("theme-dark", initialTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    document.documentElement.classList.toggle("theme-dark", nextTheme);
    window.localStorage.setItem(storageKey, nextTheme ? "dark" : "light");
  }

  return (
    <button
      aria-label="Toggle color theme"
      aria-pressed={isDark}
      className="theme-toggle"
      onClick={toggleTheme}
      type="button"
    >
      <span aria-hidden="true">{isDark ? "☾" : "☼"}</span>
      <span className="theme-toggle__label">{isDark ? "Night" : "Day"}</span>
    </button>
  );
}
