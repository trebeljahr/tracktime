import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { profileRouter } from "./routers/profile.js";
import { billingRouter } from "./routers/billing.js";
import { clientsRouter } from "./routers/clients.js";
import { projectsRouter } from "./routers/projects.js";
import { tasksRouter } from "./routers/tasks.js";
import { entriesRouter } from "./routers/entries.js";
import { favoritesRouter } from "./routers/favorites.js";
import { reportsRouter } from "./routers/reports.js";
import { settingsRouter } from "./routers/settings.js";
import { devicesRouter } from "./routers/devices.js";

export const appRouter = router({
  health: healthRouter,
  profile: profileRouter,
  billing: billingRouter,
  // ── tracktime ──────────────────────────────────────────────────────
  clients: clientsRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  entries: entriesRouter,
  favorites: favoritesRouter,
  reports: reportsRouter,
  settings: settingsRouter,
  devices: devicesRouter,
});

export type AppRouter = typeof appRouter;
