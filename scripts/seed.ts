import { readConfig } from "../apps/api/src/config";
import { SqliteStore, MongoStore } from "../apps/api/src/store";
import { ProjectService } from "../apps/api/src/service";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
const cfg = readConfig();
if (cfg.NODE_ENV === "production")
  throw new Error("Seed is for development only.");
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 10)
  throw new Error("Set SEED_PASSWORD to at least 10 characters.");
const store =
  cfg.DATA_DRIVER === "mongo"
    ? await MongoStore.open(cfg.MONGO_URI)
    : new SqliteStore(cfg.SQLITE_PATH);
try {
  const service = new ProjectService(store);
  const users = [];
  for (const username of ["alex", "sam", "taylor"]) {
    let user = await store.findAccount(`${username}@example.test`);
    if (!user) {
      user = {
        id: randomUUID(),
        username,
        email: `${username}@example.test`,
        passwordHash: await bcrypt.hash(password, 12),
      };
      await store.createAccount(user);
    }
    users.push(user);
  }
  if (!(await store.projects(users[0].id)).length) {
    const p = await service.create(users[0], {
      name: "A shared beginning",
      description: "A collaborative HTML, CSS and JavaScript starter.",
      template: "vanilla",
    });
    await service.invite(p.id, users[0], users[1].email, "EDITOR");
    await service.invite(p.id, users[0], users[2].email, "VIEWER");
    await service.createVersion(p.id, users[0], "Initial canvas");
    await service.create(users[0], {
      name: "React playground",
      description: "A React starter with a working preview.",
      template: "react",
    });
  }
  console.log(
    "Demo accounts ready: alex@example.test (owner), sam@example.test (editor), taylor@example.test (viewer). Use your SEED_PASSWORD.",
  );
} finally {
  await store.close();
}
