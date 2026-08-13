import { useEffect, useState } from 'react';

export type StudioTheme = 'dark' | 'light';

const THEME_KEY = 'ovm.theme';

function applyTheme(theme: StudioTheme): void {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): [StudioTheme, (theme: StudioTheme) => void] {
  const [theme, setTheme] = useState<StudioTheme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const initial: StudioTheme = stored === 'light' ? 'light' : 'dark';
    applyTheme(initial);
    return initial;
  });
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const set = (next: StudioTheme): void => {
    localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  };
  return [theme, set];
}
