/**
 * The quick-start tier: pinned favorites and derived recents.
 *
 * The 360px popup is where retyping a description and re-picking a project
 * hurts most, so this is the highest-value surface for the feature — but the
 * worker owns all the state, exactly as it does for the catalog. The popup
 * never fetches; it renders whatever the snapshot carries.
 *
 * Every mutation carries this worker's `ORIGIN_ID`, so the `favorites.changed`
 * event it triggers comes back tagged as ours and is ignored rather than
 * re-applied.
 */
import type {
  ApiClient,
  DetailedFavorite,
  QuickStart,
  RecentEntry,
} from "@starter/core";
import {
  ensureReady,
  ORIGIN_ID,
  getCachedFavorites,
  setCachedFavorites,
  setCachedRecents,
} from "./runtime";

/** How far back recents look, and how many the popup may show. */
const RECENT_INPUT = { limit: 6, days: 30 };

export const fetchFavorites = async (
  api: ApiClient,
): Promise<DetailedFavorite[]> => {
  const favorites = await api.query<DetailedFavorite[]>("favorites.list");
  setCachedFavorites(favorites);
  return favorites;
};

export const fetchRecents = async (
  api: ApiClient,
): Promise<RecentEntry[]> => {
  const recents = await api.query<RecentEntry[]>("entries.recent", RECENT_INPUT);
  setCachedRecents(recents);
  return recents;
};

export async function addFavorite(quick: QuickStart): Promise<DetailedFavorite> {
  const current = await ensureReady();
  const created = await current.api.mutate<DetailedFavorite>(
    "favorites.create",
    { ...quick, originId: ORIGIN_ID },
  );

  // Refetched rather than appended: the server assigns `order`, resolves the
  // catalog labels, and answers with the existing pin when this combination is
  // already pinned — so its list is the truth and ours would be a guess.
  await fetchFavorites(current.api);
  return created;
}

export async function removeFavorite(id: string): Promise<void> {
  const current = await ensureReady();
  await current.api.mutate<{ success: true; id: string }>("favorites.remove", {
    id,
    originId: ORIGIN_ID,
  });

  // Dropped locally as well as refetched: removal renumbers `order` server
  // side, and the popup is about to re-render from this snapshot.
  setCachedFavorites(
    (getCachedFavorites() ?? []).filter((favorite) => favorite.id !== id),
  );
  await fetchFavorites(current.api);
}
