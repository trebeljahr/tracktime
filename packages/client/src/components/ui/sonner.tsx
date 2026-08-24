"use client";

import * as React from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * Tracks the app's dark mode. The app toggles dark mode with a `.dark` class on
 * `<html>` (the shadcn convention wired up in `styles/globals.css`); when no
 * explicit class is present we fall back to the OS preference.
 */
function useAppTheme(): "light" | "dark" {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const resolve = (): void => {
      if (root.classList.contains("dark")) {
        setTheme("dark");
        return;
      }
      if (root.classList.contains("light")) {
        setTheme("light");
        return;
      }
      setTheme(media.matches ? "dark" : "light");
    };

    resolve();

    const observer = new MutationObserver(resolve);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", resolve);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", resolve);
    };
  }, []);

  return theme;
}

function Toaster({ ...props }: ToasterProps): React.JSX.Element {
  const theme = useAppTheme();

  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error: "group-[.toaster]:text-destructive",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast, useAppTheme };
export type { ToasterProps };
