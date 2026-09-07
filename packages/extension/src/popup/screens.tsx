import type { JSX } from "react";
import type { Route } from "./route";
import { EntriesScreen, type EntriesScreenProps } from "./entries-screen";
import {
  EntryCreateScreen,
  type EntryCreateScreenProps,
} from "./entry-create-screen";
import {
  EntryDetailScreen,
  type EntryDetailScreenProps,
} from "./entry-detail-screen";
import { SettingsScreen, type SettingsScreenProps } from "./settings-screen";
import { TrackerScreen, type TrackerScreenProps } from "./tracker-screen";

/**
 * The one place a {@link Route} becomes a screen.
 *
 * An exhaustive switch and nothing else, so `App` never grows a branch per
 * screen: it holds the stack and the callbacks, this decides what to paint,
 * and adding a screen means adding a case here rather than another ternary in
 * a component that is already the popup's only stateful thing.
 *
 * Every screen's own props come in whole, minus whatever the route already
 * carries — the open settings section, the entry's id, the manual draft. That
 * split is what keeps those three values in one place: on the route, where
 * route memory can restore them and a three-second poll cannot reset them.
 */

export type ScreensProps = {
  route: Route;
  /** The tracker's props, minus nothing — it is the root and takes them all. */
  tracker: TrackerScreenProps;
  /** Settings' props, minus the section, which the route carries. */
  settings: Omit<SettingsScreenProps, "section">;
  entries: EntriesScreenProps;
  /** The detail screen's props, minus the id, which the route carries. */
  entry: Omit<EntryDetailScreenProps, "id">;
  /** The create screen's props, minus the draft, which the route carries. */
  entryNew: Omit<EntryCreateScreenProps, "draft">;
};

export function Screens({
  route,
  tracker,
  settings,
  entries,
  entry,
  entryNew,
}: ScreensProps): JSX.Element {
  switch (route.name) {
    case "tracker":
      return <TrackerScreen {...tracker} />;
    case "settings":
      return <SettingsScreen {...settings} section={route.section} />;
    case "entries":
      return <EntriesScreen {...entries} />;
    case "entry":
      return <EntryDetailScreen {...entry} id={route.id} />;
    case "entry-new":
      return <EntryCreateScreen {...entryNew} draft={route.draft} />;
  }
}
