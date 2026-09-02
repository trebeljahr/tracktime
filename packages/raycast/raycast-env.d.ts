/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** API URL - Origin of the tracktime server, e.g. https://api.tracktime.example. */
  "apiUrl": string,
  /** Web App URL - Origin of the tracktime web app, used for the device-pairing page and Open in Browser. */
  "webUrl": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `menu-bar` command */
  export type MenuBar = ExtensionPreferences & {
  /** Menu Bar Title - What the menu bar shows while a timer runs. */
  "titleMode": "duration" | "description" | "both" | "icon",
  /** Idle - Keeps the menu bar clean; the item reappears on the next start. */
  "hideWhenIdle": boolean
}
  /** Preferences accessible in the `start-timer` command */
  export type StartTimer = ExtensionPreferences & {}
  /** Preferences accessible in the `start-favorite` command */
  export type StartFavorite = ExtensionPreferences & {}
  /** Preferences accessible in the `start-favorite` command */
  export type StartFavorite = ExtensionPreferences & {}
  /** Preferences accessible in the `stop-timer` command */
  export type StopTimer = ExtensionPreferences & {}
  /** Preferences accessible in the `toggle-timer` command */
  export type ToggleTimer = ExtensionPreferences & {}
  /** Preferences accessible in the `entries` command */
  export type Entries = ExtensionPreferences & {}
  /** Preferences accessible in the `sign-in` command */
  export type SignIn = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `menu-bar` command */
  export type MenuBar = {}
  /** Arguments passed to the `start-timer` command */
  export type StartTimer = {}
  /** Arguments passed to the `start-favorite` command */
  export type StartFavorite = {}
  /** Arguments passed to the `start-favorite` command */
  export type StartFavorite = {}
  /** Arguments passed to the `stop-timer` command */
  export type StopTimer = {}
  /** Arguments passed to the `toggle-timer` command */
  export type ToggleTimer = {}
  /** Arguments passed to the `entries` command */
  export type Entries = {}
  /** Arguments passed to the `sign-in` command */
  export type SignIn = {}
}

