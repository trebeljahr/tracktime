"use client";

import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountSettings } from "@/components/settings/account-settings";
import { DevicesPanel } from "@/components/settings/devices";
import { BillingSettings } from "@/components/settings/billing-settings";
import { GeneralSettings } from "@/components/settings/general-settings";
import { PomodoroSettingsPanel } from "@/components/settings/pomodoro-settings";
import { useWorkspaceSettings } from "@/components/settings/use-workspace-settings";

const TABS = [
  { value: "general", label: "General" },
  { value: "billing", label: "Billing" },
  { value: "pomodoro", label: "Pomodoro" },
  { value: "devices", label: "Devices" },
  { value: "account", label: "Account" },
];

export default function SettingsPage() {
  // One controller for the whole screen: General, Billing and Pomodoro all
  // write through the same optimistic `settings.update` path.
  const controller = useWorkspaceSettings();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" data-testid="settings-page">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Preferences apply to every tracktime client signed in as you. Changes
          save as you make them.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList
          className="w-full justify-start overflow-x-auto"
          data-testid="settings-tabs"
        >
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-testid={`settings-tab-${tab.value}`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" data-testid="settings-panel-general">
          <GeneralSettings controller={controller} />
        </TabsContent>
        <TabsContent value="billing" data-testid="settings-panel-billing">
          <BillingSettings controller={controller} />
        </TabsContent>
        <TabsContent value="pomodoro" data-testid="settings-panel-pomodoro">
          <PomodoroSettingsPanel controller={controller} />
        </TabsContent>
        <TabsContent value="devices" data-testid="settings-panel-devices">
          <DevicesPanel />
        </TabsContent>
        <TabsContent value="account" data-testid="settings-panel-account">
          <AccountSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
