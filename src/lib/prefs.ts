/**
 * Per-device display preferences (theme, reduced motion). Stored in localStorage and applied to <html> as
 * `data-theme` / `data-motion` by an inline script before first paint (no flash, pages stay static-renderable).
 * Dark is the default theme.
 */
export type Theme = "dark" | "light";
export const THEME_KEY = "tl-theme";
export const MOTION_KEY = "tl-motion";
export const THEME_COLORS: Record<Theme, string> = { dark: "#111315", light: "#f4f2ed" };

/** Runs in <head> before paint. Keep it tiny and dependency-free. */
export const PREFS_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}");d.dataset.theme=t==="light"?"light":"dark";if(localStorage.getItem("${MOTION_KEY}")==="reduce")d.dataset.motion="reduce";}catch(e){document.documentElement.dataset.theme="dark";}})();`;

/**
 * Re-applies the stored preferences to <html>. The boot script does this before first paint; this covers the case where
 * React re-creates <html> on the client (e.g. recovering from a hydration mismatch), which drops the attributes.
 */
export function applyStoredPrefs() {
  const d = document.documentElement;
  let theme: Theme = "dark", reduce = false;
  try {
    theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    reduce = localStorage.getItem(MOTION_KEY) === "reduce";
  } catch { /* storage blocked: defaults */ }
  if (d.dataset.theme !== theme) d.dataset.theme = theme;
  if (reduce) d.dataset.motion = "reduce";
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: the attribute still applies for this page view */ }
}

export function currentTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  store(THEME_KEY, theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  window.dispatchEvent(new CustomEvent("tl-prefs"));
}

export function reducedMotion(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce";
}

export function setReducedMotion(on: boolean) {
  if (on) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
  store(MOTION_KEY, on ? "reduce" : null);
  window.dispatchEvent(new CustomEvent("tl-prefs"));
}
