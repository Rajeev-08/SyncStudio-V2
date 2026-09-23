import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/mongo.integration.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
