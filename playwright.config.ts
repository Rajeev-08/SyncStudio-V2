import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --env-file-if-exists=.env dist/api/index.js",
    url: "http://localhost:3001/api/health",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "test",
      DATA_DRIVER: "sqlite",
      SQLITE_PATH: ".data/e2e.db",
      CLIENT_URL: "http://localhost:3001",
      PORT: "3001",
      ENABLE_DEMO: "false",
    },
  },
  workers: 1,
});
