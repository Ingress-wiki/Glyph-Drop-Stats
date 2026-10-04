import { defineConfig } from "vitest/config";

// Domain and API tests run in Node; they use only web-standard APIs that Workers also provide.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
