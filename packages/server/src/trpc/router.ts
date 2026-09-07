import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { profileRouter } from "./routers/profile.js";
import { billingRouter } from "./routers/billing.js";
import { clientsRouter } from "./routers/clients.js";
import { projectsRouter } from "./routers/projects.js";
import { tasksRouter } from "./routers/tasks.js";
import { tagsRouter } from "./routers/tags.js";
import { entriesRouter } from "./routers/entries.js";
import { favoritesRouter } from "./routers/favorites.js";
import { reportsRouter } from "./routers/reports.js";
import { settingsRouter } from "./routers/settings.js";
import { devicesRouter } from "./routers/devices.js";
import { invoicesRouter } from "./routers/invoices.js";
import { dataRouter } from "./routers/data.js";
import { apiTokensRouter } from "./routers/api-tokens.js";
import { webhooksRouter } from "./routers/webhooks.js";

export const appRouter = router({
  health: healthRouter,
  profile: profileRouter,
  billing: billingRouter,
  // ── tracktime ──────────────────────────────────────────────────────
  clients: clientsRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  tags: tagsRouter,
  entries: entriesRouter,
  favorites: favoritesRouter,
  reports: reportsRouter,
  settings: settingsRouter,
  devices: devicesRouter,
  invoices: invoicesRouter,
  data: dataRouter,
  // The management surface for the public REST API. The API itself is NOT
  // here — it is express routes under /api/v1 that call the same services
  // these routers do, never tRPC.
  apiTokens: apiTokensRouter,
  webhooks: webhooksRouter,
});

export type AppRouter = typeof appRouter;
