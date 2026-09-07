/**
 * One-time migration: single-owner documents become workspace-scoped.
 *
 *   pnpm --filter @starter/server run migrate:workspaces -- --dry-run
 *   pnpm --filter @starter/server run migrate:workspaces -- --commit
 *
 * THIS IS IRREVERSIBLE. Take a mongodump first:
 *
 *   mongodump --uri "$MONGODB_URI" --out ./backup-$(date +%Y%m%d-%H%M%S)
 *
 * What it does, per user that owns any data:
 *   1. creates a personal workspace (a better-auth organization) if the user
 *      has no membership yet;
 *   2. sets `workspaceId` on Client / Project / Task / TimeEntry / Favorite,
 *      and `createdBy` / `authorId` / `userId` from the old `ownerId`;
 *   3. moves the old merged Settings doc into WorkspaceSettings (money and
 *      calendar) and UserPreferences (rendering);
 *   4. drops the `{ ownerId: 1 }` partial-unique index and lets the models
 *      rebuild `{ authorId: 1 }`.
 *
 * It is idempotent: documents that already carry a `workspaceId` are skipped,
 * so a partial run can simply be re-run.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { initAuth, getAuth, disconnectAuth } from "../auth/auth.js";
import {
  createPersonalWorkspace,
  type WorkspaceOwner,
} from "../auth/personal-workspace.js";
import { WorkspaceMember } from "../models/WorkspaceMember.js";
import {
  UserPreferencesModel,
  WorkspaceSettingsModel,
} from "../models/Settings.js";

const COMMIT = process.argv.includes("--commit");

/** Collections carrying an owner, and what the owner becomes on each. */
const CATALOG = ["clients", "projects", "tasks"] as const;

const log = (...args: unknown[]): void => {
  console.log(COMMIT ? "[migrate]" : "[migrate:dry-run]", ...args);
};

/** Every distinct `ownerId` that still has un-migrated documents. */
async function findLegacyOwners(db: mongoose.mongo.Db): Promise<string[]> {
  const owners = new Set<string>();
  for (const name of [...CATALOG, "timeentries", "favorites", "settings"]) {
    const ids = await db
      .collection(name)
      .distinct(name === "settings" ? "userId" : "ownerId", {
        ...(name === "settings" ? {} : { workspaceId: { $exists: false } }),
      });
    for (const id of ids) if (typeof id === "string" && id) owners.add(id);
  }
  return [...owners];
}

/** The user record behind an owner id, for naming their workspace. */
async function loadUser(
  db: mongoose.mongo.Db,
  userId: string,
): Promise<WorkspaceOwner> {
  const user = await db
    .collection("user")
    .findOne({ _id: new mongoose.Types.ObjectId(userId) })
    .catch(() => null);
  return {
    id: userId,
    name: typeof user?.name === "string" ? user.name : null,
    email: typeof user?.email === "string" ? user.email : null,
  };
}

/** The user's existing workspace, or a freshly created personal one. */
async function workspaceFor(
  db: mongoose.mongo.Db,
  userId: string,
): Promise<string | null> {
  const existing = await WorkspaceMember.findOne({ userId })
    .sort({ createdAt: 1 })
    .lean();
  if (existing) return existing.workspaceId;

  const user = await loadUser(db, userId);
  if (!COMMIT) {
    log(`would create personal workspace for ${userId} (${user.email ?? "?"})`);
    return `dry-run-workspace-for-${userId}`;
  }
  return createPersonalWorkspace(getAuth().api, user);
}

async function migrateOwner(
  db: mongoose.mongo.Db,
  ownerId: string,
): Promise<void> {
  const workspaceId = await workspaceFor(db, ownerId);
  if (!workspaceId) {
    console.error(`[migrate] FAILED to resolve a workspace for ${ownerId}`);
    return;
  }
  log(`owner ${ownerId} -> workspace ${workspaceId}`);

  // Catalog: scope + audit author.
  for (const name of CATALOG) {
    const filter = { ownerId, workspaceId: { $exists: false } };
    const count = await db.collection(name).countDocuments(filter);
    if (count === 0) continue;
    log(`  ${name}: ${count}`);
    if (COMMIT) {
      await db
        .collection(name)
        .updateMany(filter, [
          { $set: { workspaceId, createdBy: "$ownerId" } },
          { $unset: "ownerId" },
        ]);
    }
  }

  // Entries: scope + LOAD-BEARING author.
  const entryFilter = { ownerId, workspaceId: { $exists: false } };
  const entries = await db.collection("timeentries").countDocuments(entryFilter);
  if (entries > 0) {
    log(`  timeentries: ${entries}`);
    if (COMMIT) {
      await db
        .collection("timeentries")
        .updateMany(entryFilter, [
          { $set: { workspaceId, authorId: "$ownerId" } },
          { $unset: "ownerId" },
        ]);
    }
  }

  // Favorites carry BOTH axes: the workspace the pinned project lives in,
  // and the person whose shortcut it is.
  const favouriteFilter = { ownerId, workspaceId: { $exists: false } };
  const favorites = await db
    .collection("favorites")
    .countDocuments(favouriteFilter);
  if (favorites > 0) {
    log(`  favorites: ${favorites}`);
    if (COMMIT) {
      await db
        .collection("favorites")
        .updateMany(favouriteFilter, [
          { $set: { workspaceId, userId: "$ownerId" } },
          { $unset: "ownerId" },
        ]);
    }
  }

  // Settings: one merged doc becomes two, split by who owns each field.
  const legacy = await db.collection("settings").findOne({ userId: ownerId });
  if (legacy) {
    log(`  settings -> workspace settings + user preferences`);
    if (COMMIT) {
      await WorkspaceSettingsModel.updateOne(
        { workspaceId },
        {
          $setOnInsert: {
            workspaceId,
            defaultHourlyRate: legacy.defaultHourlyRate ?? 0,
            currency: legacy.currency ?? "EUR",
            weekStartsOn: legacy.weekStartsOn ?? 1,
          },
        },
        { upsert: true },
      );
      await UserPreferencesModel.updateOne(
        { userId: ownerId },
        {
          $setOnInsert: {
            userId: ownerId,
            timeFormat: legacy.timeFormat ?? "24h",
            durationFormat: legacy.durationFormat ?? "hms",
          },
        },
        { upsert: true },
      );
    }
  }
}

/**
 * Swap the one-running-timer index.
 *
 * The old index is keyed on `ownerId`, which no longer exists on the
 * documents; leaving it in place would let a second running entry be inserted
 * before the models rebuild theirs. Mongoose creates `{ authorId: 1 }` on next
 * boot from the schema.
 */
async function dropLegacyIndexes(db: mongoose.mongo.Db): Promise<void> {
  const collections = [...CATALOG, "timeentries", "favorites"];
  for (const name of collections) {
    const indexes = await db.collection(name).indexes().catch(() => []);
    for (const index of indexes) {
      const keys = Object.keys(index.key ?? {});
      if (!keys.includes("ownerId")) continue;
      log(`  drop index ${name}.${index.name}`);
      if (COMMIT) await db.collection(name).dropIndex(String(index.name));
    }
  }
}

async function main(): Promise<void> {
  if (!COMMIT) {
    console.log(
      "\nDRY RUN — nothing will be written. Re-run with --commit to apply.\n" +
        "Take a mongodump first; this migration is irreversible.\n",
    );
  }

  await mongoose.connect(env.MONGODB_URI);
  await initAuth();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no database handle after connect");

  const owners = await findLegacyOwners(db);
  log(`${owners.length} owner(s) with data to migrate`);

  for (const ownerId of owners) {
    await migrateOwner(db, ownerId);
  }

  await dropLegacyIndexes(db);

  log("done");
  await disconnectAuth();
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[migrate] failed:", error);
  await disconnectAuth().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
