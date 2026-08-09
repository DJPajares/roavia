import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  oxc: false,
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
