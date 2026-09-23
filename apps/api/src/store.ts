import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import mongoose from "mongoose";
import type {
  Account,
  Project,
  Session,
} from "../../../packages/shared/src/index";
export interface Store {
  account(id: string): Promise<Account | undefined>;
  findAccount(email: string): Promise<Account | undefined>;
  createAccount(a: Account): Promise<void>;
  session(id: string): Promise<Session | undefined>;
  saveSession(s: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  project(id: string): Promise<Project | undefined>;
  projects(userId: string): Promise<Project[]>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  close(): Promise<void>;
}
export class SqliteStore implements Store {
  db: DatabaseSync;
  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,username TEXT UNIQUE NOT NULL,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,userId TEXT NOT NULL,expiresAt INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expiresAt);CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);`,
    );
  }
  async account(id: string) {
    const row = this.db.prepare("SELECT data FROM users WHERE id=?").get(id);
    return row ? (JSON.parse(row.data as string) as Account) : undefined;
  }
  async findAccount(email: string) {
    const row = this.db
      .prepare("SELECT data FROM users WHERE email=?")
      .get(email);
    return row ? (JSON.parse(row.data as string) as Account) : undefined;
  }
  async createAccount(a: Account) {
    this.db
      .prepare("INSERT INTO users VALUES(?,?,?,?)")
      .run(a.id, a.email, a.username.toLowerCase(), JSON.stringify(a));
  }
  async session(id: string) {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id=? AND expiresAt>?")
      .get(id, Date.now());
    return row as Session | undefined;
  }
  async saveSession(s: Session) {
    this.db.prepare("DELETE FROM sessions WHERE expiresAt<?").run(Date.now());
    this.db
      .prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)")
      .run(s.id, s.userId, s.expiresAt);
  }
  async deleteSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
  }
  async project(id: string) {
    const row = this.db.prepare("SELECT data FROM projects WHERE id=?").get(id);
    return row ? (JSON.parse(row.data as string) as Project) : undefined;
  }
  async projects(userId: string) {
    return this.db
      .prepare("SELECT data FROM projects")
      .all()
      .map((r) => JSON.parse(r.data as string) as Project)
      .filter((p) => p.members[userId]);
  }
  async saveProject(p: Project) {
    this.db
      .prepare(
        "INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(p.id, JSON.stringify(p));
  }
  async deleteProject(id: string) {
    this.db.prepare("DELETE FROM projects WHERE id=?").run(id);
  }
  async close() {
    this.db.close();
  }
}
const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  email: { type: String, unique: true },
  usernameKey: { type: String, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
});
const sessionSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  userId: String,
  expiresAt: Date,
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const projectModelSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true },
    memberIds: { type: [String], index: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { minimize: false },
);
export class MongoStore implements Store {
  private users = mongoose.model("Account", userSchema);
  private sessions = mongoose.model("Session", sessionSchema);
  private records = mongoose.model("Workspace", projectModelSchema);
  static async open(uri: string) {
    await mongoose.connect(uri);
    const store = new MongoStore();
    await Promise.all([
      store.users.init(),
      store.sessions.init(),
      store.records.init(),
    ]);
    return store;
  }
  async account(id: string) {
    return (await this.users.findOne({ id }).lean())?.data as
      Account | undefined;
  }
  async findAccount(email: string) {
    return (await this.users.findOne({ email }).lean())?.data as
      Account | undefined;
  }
  async createAccount(a: Account) {
    await this.users.create({
      id: a.id,
      email: a.email,
      usernameKey: a.username.toLowerCase(),
      data: a,
    });
  }
  async session(id: string) {
    const s = await this.sessions
      .findOne({ id, expiresAt: { $gt: new Date() } })
      .lean();
    return s
      ? { id: s.id!, userId: s.userId!, expiresAt: s.expiresAt!.getTime() }
      : undefined;
  }
  async saveSession(s: Session) {
    await this.sessions.create({ ...s, expiresAt: new Date(s.expiresAt) });
  }
  async deleteSession(id: string) {
    await this.sessions.deleteOne({ id });
  }
  async project(id: string) {
    return (await this.records.findOne({ id }).lean())?.data as
      Project | undefined;
  }
  async projects(userId: string) {
    return (await this.records.find({ memberIds: userId }).lean()).map(
      (p) => p.data as Project,
    );
  }
  async saveProject(p: Project) {
    await this.records.replaceOne(
      { id: p.id },
      { id: p.id, memberIds: Object.keys(p.members), data: p },
      { upsert: true },
    );
  }
  async deleteProject(id: string) {
    await this.records.deleteOne({ id });
  }
  async close() {
    await mongoose.disconnect();
  }
}
