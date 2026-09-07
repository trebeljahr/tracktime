import type { Metadata, Viewport } from "next";
import { TRPCProvider } from "@/providers/trpc-provider";
import { AuthProvider } from "@/providers/auth-provider";
import { MobileBridgeLoader } from "@/mobile/MobileBridgeLoader";
import { Toaster } from "@/components/ui/sonner";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "tracktime",
    template: "%s | tracktime",
  },
  description: "Time tracking with reporting that actually answers questions",
  manifest: "/manifest.json",
};

/**
 * `width=device-width, initial-scale=1` is Next's own default and is merged in
 * underneath this (lib/metadata/default-metadata.js `createDefaultViewport`),
 * so it does not need repeating here.
 *
 * `viewportFit: "cover"` is the gating change for every safe-area rule in
 * styles/native.css: without `viewport-fit=cover` WKWebView letterboxes the
 * page inside the safe area itself and `env(safe-area-inset-*)` resolves to
 * `0px`, so the inset CSS is silently inert rather than wrong.
 *
 * `interactiveWidget: "resizes-content"` makes the software keyboard shrink
 * the layout viewport instead of only the visual one, which is what lets a
 * focused field inside a scrollable dialog be scrolled above the keyboard
 * rather than sitting behind it.
 *
 * Deliberately NOT here: `maximumScale` / `userScalable`. iOS zooms on focus
 * for any field under 16px, and pinning the scale would "fix" that by
 * disabling pinch-zoom for the web app too — an accessibility regression to
 * paper over a font size. native.css sets 16px on native fields instead.
 */
export const viewport: Viewport = {
  themeColor: "#4F46E5",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

/**
 * Runs before first paint so the theme class is on <html> ahead of any
 * styled content — without it, a dark-mode user sees a white flash on
 * every hard navigation. Keep the storage key in sync with
 * `THEME_STORAGE_KEY` in components/theme-toggle.tsx.
 */
const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("tracktime.theme");if(c!=="light"&&c!=="dark")c=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.classList.remove("light","dark");r.classList.add(c);r.style.colorScheme=c;}catch(e){}})();`;

/**
 * Marks the document as running inside the native shell, before the first
 * paint of anything inside <body>.
 *
 * `mobile/bridge.ts` sets the same two things, but only after
 * `Promise.all([import("@capacitor/core"), …])` has resolved — several frames
 * into the launch, and after React has already painted. Every rule in
 * styles/native.css keys off `body.cap`, so without this the app lays out once
 * with the header under the Dynamic Island and the composer under the home
 * indicator, then jumps. The bridge's own writes stay: they are idempotent,
 * and they are the recovery path if React ever did clobber body's className
 * while hydrating.
 *
 * Rendered as the first child of <body> rather than in <head>, because in
 * <head> `document.body` does not exist yet. Capacitor's native bridge is
 * injected as a document-start WKUserScript, so `window.Capacitor` is already
 * there — the same assumption `isNative()` in bridge.ts has always made.
 */
const NATIVE_SHELL_SCRIPT = `(function(){try{var c=window.Capacitor;if(!c||!c.isNativePlatform||!c.isNativePlatform())return;var b=document.body;b.classList.add("cap");b.setAttribute("data-platform",c.getPlatform?c.getPlatform():"unknown");}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* OpenPanel analytics — replace with your client ID */}
        {process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID && (
          <script
            defer
            async
            src="https://openpanel.dev/op.js"
            data-client-id={process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID}
            data-track-screenviews="true"
          />
        )}
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && (
          <script
            defer
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
            src={
              process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL ||
              "https://plausible.io/js/script.js"
            }
          />
        )}
      </head>
      <body
        className="min-h-screen bg-background font-sans antialiased"
        suppressHydrationWarning
      >
        <script dangerouslySetInnerHTML={{ __html: NATIVE_SHELL_SCRIPT }} />
        <MobileBridgeLoader />
        <TRPCProvider>
          <AuthProvider>{children}</AuthProvider>
        </TRPCProvider>
        <Toaster />
      </body>
    </html>
  );
}
