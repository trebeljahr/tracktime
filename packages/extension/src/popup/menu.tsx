import { useEffect, useRef, useState, type JSX } from "react";

/**
 * The overflow menu: the ways out of a popup that deliberately does very
 * little.
 *
 * Everything here either opens the web app — which owns editing, reports and
 * settings — or changes something the popup itself cannot express. Keeping
 * those behind one button is what leaves the tracker screen to the timer.
 */

export type MenuProps = {
  /** Web app origin, discovered from the API. Null hides the links. */
  webUrl: string | null;
  /** True when this session is shared with the web app, which changes what signing out does. */
  sharedSession: boolean;
  onEditApiUrl: () => void;
  onSignOut: () => void;
};

const openTab = (url: string): void => {
  // No `tabs` permission needed to create one, and the popup closes as soon as
  // focus leaves it — so nothing here has to survive the click.
  void chrome.tabs.create({ url });
};

const join = (base: string, path: string): string =>
  `${base.replace(/\/$/, "")}${path}`;

export function Menu({
  webUrl,
  sharedSession,
  onEditApiUrl,
  onSignOut,
}: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      <button
        type="button"
        className="menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        onClick={() => setOpen((current) => !current)}
        data-testid="menu-trigger"
      >
        ⋯
      </button>

      {open && (
        <div className="menu__list" role="menu" data-testid="menu-list">
          {webUrl !== null && (
            <>
              <button
                type="button"
                role="menuitem"
                className="menu__item"
                onClick={() => openTab(join(webUrl, "/track"))}
                data-testid="menu-open-app"
              >
                Open tracktime
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu__item"
                onClick={() => openTab(join(webUrl, "/reports/summary"))}
                data-testid="menu-reports"
              >
                Reports
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu__item"
                onClick={() => openTab(join(webUrl, "/settings"))}
                data-testid="menu-settings"
              >
                Settings
              </button>
              <hr className="menu__rule" />
            </>
          )}

          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              onEditApiUrl();
            }}
            data-testid="menu-api-url"
          >
            Change API URL…
          </button>

          <button
            type="button"
            role="menuitem"
            className="menu__item menu__item--danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            data-testid="menu-sign-out"
          >
            Sign out
          </button>

          {sharedSession && (
            <p className="menu__note">
              Signed in with the web app’s session — signing out here signs out
              tracktime in this browser too.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
