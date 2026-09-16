'use client';

import { useEffect, useState } from 'react';
type Theme = 'system' | 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tulink-theme');
      setTheme(saved === 'light' || saved === 'dark' ? saved : 'system');
    } catch {
      setTheme('system');
    }
  }, []);
  useEffect(() => {
    if (theme === null) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return (
    <label className="theme-control">
      <span>Appearance</span>
      <select
        aria-label="Dashboard appearance"
        value={theme ?? 'system'}
        onChange={(event) => {
          const value = event.target.value as Theme;
          setTheme(value);
          try {
            localStorage.setItem('tulink-theme', value);
          } catch {
            /* Keep the choice for this session. */
          }
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
