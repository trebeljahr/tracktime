import { describe, expect, it } from "vitest";
import { Euro, PoundSterling } from "lucide-react";
import { CURRENCY_FALLBACK_ICON, currencyIcon, currencySymbol } from "./currency";

describe("currencyIcon", () => {
  it("maps codes lucide draws a symbol for", () => {
    expect(currencyIcon("EUR")).toBe(Euro);
    expect(currencyIcon("GBP")).toBe(PoundSterling);
  });

  it("is case-insensitive", () => {
    expect(currencyIcon("eur")).toBe(Euro);
  });

  it("returns null for codes with no dedicated icon", () => {
    expect(currencyIcon("SEK")).toBeNull();
    expect(currencyIcon("PLN")).toBeNull();
    expect(currencyIcon("NOPE")).toBeNull();
  });

  it("offers a generic icon for slots that demand one", () => {
    expect(CURRENCY_FALLBACK_ICON).toBeTruthy();
  });
});

describe("currencySymbol", () => {
  it("returns the narrow symbol for known codes", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
  });

  it("covers codes that have no lucide icon", () => {
    // Whatever ICU picks, it must not fall back to the bare code.
    expect(currencySymbol("SEK")).not.toBe("SEK");
    expect(currencySymbol("PLN")).not.toBe("PLN");
  });

  it("falls back to the code itself when Intl rejects it", () => {
    expect(currencySymbol("ZZZZ")).toBe("ZZZZ");
  });

  it("normalizes case", () => {
    expect(currencySymbol("eur")).toBe("€");
  });
});
