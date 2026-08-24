// IMPLEMENTED BY: server skeleton agent (complete — no stubs here)
import {
  updateSettingsSchema,
  type PomodoroSettings,
  type WorkspaceSettings,
} from "@starter/shared";
import {
  Settings,
  getOrCreateSettings,
  toClientSettings,
} from "../../models/Settings.js";
import { publishSync } from "../../ws/sync.js";
import { protectedProcedure, router } from "../trpc.js";

export const settingsRouter = router({
  /** Reads the caller's workspace settings, seeding defaults on first use. */
  get: protectedProcedure.query(
    async ({ ctx }): Promise<WorkspaceSettings> => {
      return getOrCreateSettings(ctx.user.id);
    },
  ),

  /** Partial update — omitted fields keep their current value. */
  update: protectedProcedure
    .input(updateSettingsSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceSettings> => {
      const current = await getOrCreateSettings(ctx.user.id);

      const pomodoro: PomodoroSettings = {
        ...current.pomodoro,
        ...(input.pomodoro ?? {}),
      };

      const next: Omit<WorkspaceSettings, "userId"> = {
        defaultHourlyRate: input.defaultHourlyRate ?? current.defaultHourlyRate,
        currency: input.currency ?? current.currency,
        weekStartsOn: input.weekStartsOn ?? current.weekStartsOn,
        timeFormat: input.timeFormat ?? current.timeFormat,
        durationFormat: input.durationFormat ?? current.durationFormat,
        pomodoro,
      };

      const updated = await Settings.findOneAndUpdate(
        { userId: ctx.user.id },
        { $set: next },
        { new: true, upsert: true },
      ).lean();

      const settings = updated
        ? toClientSettings(updated)
        : { userId: ctx.user.id, ...next };

      publishSync(ctx.user.id, { kind: "settings.changed" }, input.originId);
      return settings;
    }),
});
