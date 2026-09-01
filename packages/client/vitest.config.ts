import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest needs the same "@/" alias the app and tsconfig use. Without it any
 * test that pulls in a module importing "@/..." fails to resolve, which
 * limited unit tests to alias-free files.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
