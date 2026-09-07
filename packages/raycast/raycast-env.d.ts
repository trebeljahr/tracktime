/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** API URL - Origin of the tracktime server, e.g. https://api.tracktime.example. Empty means the deployed server, or the local dev server under `ray develop`. */
  "apiUrl"?: string,
  /** Web App URL - Origin of the tracktime web app, used for the device-pairing page and Open in Browser. Empty follows the API URL's default. */
  "webUrl"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `menu-bar` command */
  export type MenuBar = ExtensionPreferences & {
  /** Menu Bar Title - What the menu bar shows while a timer runs. */
  "titleMode": "duration" | "description" | "both" | "icon",
  /** Clock - Keeps the command loaded so the menu bar clock moves every second. Off shows minutes, refreshed on the command's interval. */
  "tickSeconds": boolean,
  /** Idle - Keeps the menu bar clean; the item reappears on the next start. */
  "hideWhenIdle": boolean
}
  /** Preferences accessible in the `timer` command */
  export type Timer = ExtensionPreferences & {}
  /** Preferences accessible in the `entries` command */
  export type Entries = ExtensionPreferences & {}
  /** Preferences accessible in the `open-dashboard` command */
  export type OpenDashboard = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `menu-bar` command */
  export type MenuBar = {}
  /** Arguments passed to the `timer` command */
  export type Timer = {}
  /** Arguments passed to the `entries` command */
  export type Entries = {}
  /** Arguments passed to the `open-dashboard` command */
  export type OpenDashboard = {}
}

