/**
 * The two scripts `app/layout.tsx` inlines into <head>, and the reason they
 * are here rather than inline in that file: a layout module may only export
 * what Next recognises, so a constant declared there cannot be reached by a
 * test. Both of these run before the first paint and neither is imported by
 * anything else at runtime.
 */

/**
 * Runs before first paint so the theme class is on <html> ahead of any
 * styled content — without it, a dark-mode user sees a white flash on
 * every hard navigation. Keep the storage key in sync with
 * `THEME_STORAGE_KEY` in components/theme-toggle.tsx.
 *
 * Its `classList.remove("light", "dark")` is deliberately narrow: it must not
 * disturb the `cap` class the script below may already have added, and the
 * two are order-independent because of it.
 */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("tracktime.theme");if(c!=="light"&&c!=="dark")c=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.classList.remove("light","dark");r.classList.add(c);r.style.colorScheme=c;}catch(e){}})();`;

/**
 * Marks the document as running inside the native shell, before the first
 * paint of anything.
 *
 * `mobile/bridge.ts` sets the same two things, but only after
 * `Promise.all([import("@capacitor/core"), …])` has resolved — several frames
 * into the launch, and after React has already painted. Every rule in
 * styles/native.css keys off `html.cap`, so without this the app lays out once
 * with the header under the Dynamic Island and the composer under the home
 * indicator, then jumps. The bridge's own writes stay: they are idempotent,
 * and they are the recovery path if React ever did clobber the className
 * while hydrating.
 *
 * IT MARKS <html>, NOT <body>, and that is the whole reason it can live in
 * <head>. A script that mutates <body> before hydration makes <body>'s
 * attributes disagree with the server HTML, which React reports as a
 * mismatch — and the only way to silence that is `suppressHydrationWarning` on
 * <body>, which then silences every OTHER body-level mismatch for the web app
 * as well, permanently. <html> already carries that attribute for the theme
 * script, whose class write has exactly the same shape, so folding the second
 * marker onto the same element costs nothing and hands <body> its warnings
 * back.
 *
 * `document.documentElement` exists while <head> is being parsed, so this can
 * run there — earlier than a <body> script could. Capacitor's native bridge is
 * injected as a document-start WKUserScript, so `window.Capacitor` is already
 * there — the same assumption `isNative()` in bridge.ts has always made.
 */
export const NATIVE_SHELL_SCRIPT = `(function(){try{var c=window.Capacitor;if(!c||!c.isNativePlatform||!c.isNativePlatform())return;var r=document.documentElement;r.classList.add("cap");r.setAttribute("data-platform",c.getPlatform?c.getPlatform():"unknown");}catch(e){}})();`;
