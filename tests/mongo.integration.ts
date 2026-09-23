import { beforeAll, afterAll, it, expect } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoStore } from "../apps/api/src/store";
import { ProjectService } from "../apps/api/src/service";
import type { User } from "../packages/shared/src/index";
let mongo: MongoMemoryServer;
let store: MongoStore;
let service: ProjectService;
const user: User = {
  id: crypto.randomUUID(),
  username: "mongo-" + crypto.randomUUID(),
  email: crypto.randomUUID() + "@example.test",
};
beforeAll(async () => {
  if (!process.env.MONGO_TEST_URI) mongo = await MongoMemoryServer.create();
  store = await MongoStore.open(process.env.MONGO_TEST_URI ?? mongo.getUri());
  service = new ProjectService(store);
  await store.createAccount({ ...user, passwordHash: "test-hash" });
}, 120000);
afterAll(async () => {
  if (store) await store.close();
  if (mongo) await mongo.stop();
});
it("stores accounts and sessions with expiration", async () => {
  expect((await store.findAccount(user.email))?.id).toBe(user.id);
  await store.saveSession({
    id: "valid",
    userId: user.id,
    expiresAt: Date.now() + 60000,
  });
  await store.saveSession({
    id: "expired",
    userId: user.id,
    expiresAt: Date.now() - 1000,
  });
  expect((await store.session("valid"))?.userId).toBe(user.id);
  expect(await store.session("expired")).toBeUndefined();
});
it("persists projects, memberships, full filesystem and atomic recovery snapshots", async () => {
  const p = await service.create(user, {
    name: "Mongo workspace",
    description: "",
    template: "react",
  });
  const snapshot = await service.createVersion(p.id, user, "Baseline");
  await service.createFile(p.id, user, {
    path: "extra.ts",
    type: "file",
    content: "const n=1;",
  });
  await service.restore(p.id, user, snapshot.id);
  const saved = await store.project(p.id);
  expect(saved?.epoch).toBe(1);
  expect(saved?.files.some((f) => f.path === "extra.ts")).toBe(false);
  expect(saved?.versions[0].files.some((f) => f.path === "extra.ts")).toBe(
    true,
  );
  expect(await store.projects(user.id)).toHaveLength(1);
  expect(await store.projects(crypto.randomUUID())).toHaveLength(0);
});
