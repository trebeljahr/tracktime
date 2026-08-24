import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { profileRouter } from "./routers/profile.js";
import { itemsRouter } from "./routers/items.js";
import { billingRouter } from "./routers/billing.js";
import { clientsRouter } from "./routers/clients.js";
import { projectsRouter } from "./routers/projects.js";
import { tasksRouter } from "./routers/tasks.js";
import { entriesRouter } from "./routers/entries.js";
import { reportsRouter } from "./routers/reports.js";
import { settingsRouter } from "./routers/settings.js";
import { tokensRouter } from "./routers/tokens.js";

export const appRouter = router({
  health: healthRouter,
  profile: profileRouter,
  items: itemsRouter,
  billing: billingRouter,
  // ── tracktime ──────────────────────────────────────────────────────
  clients: clientsRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  entries: entriesRouter,
  reports: reportsRouter,
  settings: settingsRouter,
  tokens: tokensRouter,
});

export type AppRouter = typeof appRouter;
