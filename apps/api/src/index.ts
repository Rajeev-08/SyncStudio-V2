import { readConfig } from "./config";
import { SqliteStore, MongoStore } from "./store";
import { createApp } from "./app";
const cfg = readConfig();
const store =
  cfg.DATA_DRIVER === "mongo"
    ? await MongoStore.open(cfg.MONGO_URI)
    : new SqliteStore(cfg.SQLITE_PATH);
const { http, socket, service, local } = createApp(store, cfg);
http.listen(
  cfg.PORT,
  cfg.LOCAL_EXECUTION === "true" ? "127.0.0.1" : "0.0.0.0",
  () =>
    console.log(`SyncStudio API listening on ${cfg.PORT} (${cfg.DATA_DRIVER})`),
);
async function shutdown() {
  local.close();
  await new Promise<void>((resolve) => socket.io.close(() => resolve()));
  await service.drain();
  await store.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
