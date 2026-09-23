import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import type { Store } from "./store";
import { assert } from "./errors";
import { makeFile, templateFiles } from "./templates";
import type {
  Project,
  Role,
  User,
  Version,
  Workspace,
  Template,
} from "../../../packages/shared/src/index";
export class ProjectService {
  private locks = new Map<string, Promise<unknown>>();
  constructor(public store: Store) {}
  async drain() {
    await Promise.allSettled([...this.locks.values()]);
  }
  async serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(fn);
    this.locks.set(id, pending);
    try {
      return await pending;
    } finally {
      if (this.locks.get(id) === pending) this.locks.delete(id);
    }
  }
  async get(id: string, userId: string, min: Role = "VIEWER") {
    const p = await this.store.project(id);
    assert(p, 404, "NOT_FOUND", "Project not found.");
    const role = p.members[userId];
    assert(
      role,
      403,
      "PROJECT_FORBIDDEN",
      "You do not have access to this project.",
    );
    assert(
      { VIEWER: 0, EDITOR: 1, OWNER: 2 }[role] >=
        { VIEWER: 0, EDITOR: 1, OWNER: 2 }[min],
      403,
      "ROLE_FORBIDDEN",
      `${min.toLowerCase()} access is required.`,
    );
    return p;
  }
  activity(p: Project, user: User, action: string, target: string) {
    p.activity.unshift({
      id: randomUUID(),
      actor: user.username,
      action,
      target,
      createdAt: new Date().toISOString(),
    });
    p.activity = p.activity.slice(0, 300);
  }
  async mutate<T>(
    id: string,
    user: User,
    min: Role,
    fn: (p: Project) => T | Promise<T>,
  ) {
    return this.serial(id, async () => {
      const p = await this.get(id, user.id, min);
      const result = await fn(p);
      p.revision++;
      p.updatedAt = new Date().toISOString();
      assert(
        p.files.length <= 150,
        422,
        "PROJECT_LIMIT",
        "A workspace supports up to 150 files and folders.",
      );
      assert(
        Buffer.byteLength(JSON.stringify(p)) < 10_000_000,
        422,
        "PROJECT_LIMIT",
        "Workspace storage limit reached. Export or remove older snapshots.",
      );
      await this.store.saveProject(p);
      return result;
    });
  }
  async create(
    user: User,
    input: { name: string; description: string; template: Template },
  ) {
    assert(
      (await this.store.projects(user.id)).filter((p) => p.owner === user.id)
        .length < 50,
      422,
      "PROJECT_LIMIT",
      "You can own up to 50 projects.",
    );
    const now = new Date().toISOString();
    const p: Project = {
      ...input,
      id: randomUUID(),
      owner: user.id,
      members: { [user.id]: "OWNER" },
      files: templateFiles(input.template),
      versions: [],
      comments: [],
      activity: [],
      epoch: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.activity(p, user, "created project", p.name);
    await this.store.saveProject(p);
    return p;
  }
  async workspace(id: string, userId: string): Promise<Workspace> {
    const p = await this.get(id, userId);
    const people = await Promise.all(
      Object.entries(p.members).map(async ([uid, role]) => {
        const u = await this.store.account(uid);
        return {
          id: uid,
          username: u?.username ?? "Deleted user",
          email: u?.email ?? "",
          role,
        };
      }),
    );
    return {
      ...p,
      files: p.files.map((f) => ({ ...f, state: "" })),
      role: p.members[userId],
      people,
      versions: p.versions.map(({ files: _files, ...v }) => v),
    };
  }
  ensurePath(p: Project, path: string, ignore?: string) {
    assert(
      !p.files.some((f) => f.path === path && f.id !== ignore),
      409,
      "PATH_EXISTS",
      "A file or folder already exists at this path.",
    );
    const parent = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    assert(
      !parent || p.files.some((f) => f.path === parent && f.type === "folder"),
      422,
      "INVALID_PARENT",
      "Create the parent folder first.",
    );
  }
  createFile(
    id: string,
    user: User,
    input: { path: string; type: "file" | "folder"; content: string },
  ) {
    return this.mutate(id, user, "EDITOR", (p) => {
      this.ensurePath(p, input.path);
      const file = makeFile(
        input.path,
        input.type === "folder" ? "" : input.content,
        input.type,
      );
      p.files.push(file);
      this.activity(p, user, `created ${file.type}`, file.path);
      return file;
    });
  }
  renameFile(id: string, user: User, fileId: string, path: string) {
    return this.mutate(id, user, "EDITOR", (p) => {
      const f = p.files.find((f) => f.id === fileId);
      assert(f, 404, "NOT_FOUND", "File not found.");
      assert(
        !path.startsWith(f.path + "/"),
        422,
        "INVALID_MOVE",
        "A folder cannot be moved inside itself.",
      );
      this.ensurePath(p, path, fileId);
      const old = f.path;
      const moving = p.files.filter(
        (n) =>
          n.id === f.id ||
          (f.type === "folder" && n.path.startsWith(old + "/")),
      );
      for (const node of moving) {
        const next = path + node.path.slice(old.length);
        assert(
          !p.files.some((n) => !moving.includes(n) && n.path === next),
          409,
          "PATH_EXISTS",
          "Destination already exists.",
        );
        node.path = next;
      }
      this.activity(p, user, "renamed", `${old} → ${path}`);
      return f;
    });
  }
  deleteFile(id: string, user: User, fileId: string) {
    return this.mutate(id, user, "EDITOR", (p) => {
      const f = p.files.find((f) => f.id === fileId);
      assert(f, 404, "NOT_FOUND", "File not found.");
      const removed = p.files
        .filter(
          (n) =>
            n.id === fileId ||
            (f.type === "folder" && n.path.startsWith(f.path + "/")),
        )
        .map((n) => n.id);
      p.files = p.files.filter((n) => !removed.includes(n.id));
      p.comments = p.comments.filter((c) => !removed.includes(c.fileId));
      this.activity(p, user, "deleted", f.path);
    });
  }
  async update(
    id: string,
    user: User,
    fileId: string,
    epoch: number,
    update: Uint8Array,
  ) {
    return this.mutate(id, user, "EDITOR", (p) => {
      assert(
        p.epoch === epoch,
        409,
        "STALE_EPOCH",
        "This project was restored. Reopen it to load the restored version. Your old offline edits remain in this browser.",
      );
      const f = p.files.find((f) => f.id === fileId && f.type === "file");
      assert(f, 404, "NOT_FOUND", "File not found.");
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, Buffer.from(f.state, "base64"));
        Y.applyUpdate(doc, update);
        const content = doc.getText("content").toString();
        assert(
          content.length <= 200000,
          422,
          "FILE_LIMIT",
          "File exceeds 200,000 characters.",
        );
        const state = Y.encodeStateAsUpdate(doc);
        assert(
          state.length <= 1_000_000,
          422,
          "DOCUMENT_LIMIT",
          "Collaborative document exceeds its storage limit.",
        );
        f.content = content;
        f.state = Buffer.from(state).toString("base64");
        return { revision: p.revision + 1 };
      } finally {
        doc.destroy();
      }
    });
  }
  snapshot(p: Project, user: User, message: string) {
    assert(
      p.versions.length < 30,
      422,
      "VERSION_LIMIT",
      "Remove an older snapshot before creating another.",
    );
    const last = p.versions[0];
    const changed =
      p.files.filter(
        (f) =>
          !last?.files.some(
            (old) => old.path === f.path && old.content === f.content,
          ),
      ).length +
      (last?.files.filter((f) => !p.files.some((n) => n.path === f.path))
        .length ?? 0);
    const v: Version = {
      id: randomUUID(),
      message,
      author: user.username,
      createdAt: new Date().toISOString(),
      files: structuredClone(p.files),
      changedFiles: changed,
    };
    p.versions.unshift(v);
    return v;
  }
  createVersion(id: string, user: User, message: string) {
    return this.mutate(id, user, "EDITOR", (p) => {
      const v = this.snapshot(p, user, message);
      this.activity(p, user, "created snapshot", message);
      return v;
    });
  }
  restore(id: string, user: User, versionId: string) {
    return this.mutate(id, user, "OWNER", (p) => {
      const v = p.versions.find((v) => v.id === versionId);
      assert(v, 404, "NOT_FOUND", "Snapshot not found.");
      this.snapshot(p, user, `Recovery before restoring: ${v.message}`);
      p.files = v.files.map((f) => makeFile(f.path, f.content, f.type));
      p.epoch++;
      p.comments = [];
      this.activity(p, user, "restored snapshot", v.message);
      return p.epoch;
    });
  }
  async invite(
    id: string,
    user: User,
    email: string,
    role: "EDITOR" | "VIEWER",
  ) {
    await this.get(id,user.id,"OWNER");
    const target = await this.store.findAccount(email);
    assert(
      target,
      404,
      "USER_NOT_FOUND",
      "Ask this person to create an account first.",
    );
    return this.mutate(id, user, "OWNER", (p) => {
      assert(
        target.id !== p.owner,
        422,
        "OWNER_IMMUTABLE",
        "The owner role cannot be changed.",
      );
      assert(
        Object.keys(p.members).length < 30 || p.members[target.id],
        422,
        "MEMBER_LIMIT",
        "A workspace supports up to 30 members.",
      );
      p.members[target.id] = role;
      this.activity(p, user, "added member", target.username);
      return target.id;
    });
  }
  member(
    id: string,
    user: User,
    uid: string,
    role: "EDITOR" | "VIEWER" | null,
  ) {
    return this.mutate(id, user, "OWNER", (p) => {
      assert(
        uid !== p.owner,
        422,
        "OWNER_IMMUTABLE",
        "The owner cannot be removed or demoted.",
      );
      assert(p.members[uid], 404, "NOT_FOUND", "Member not found.");
      if (role) p.members[uid] = role;
      else delete p.members[uid];
      this.activity(
        p,
        user,
        role ? "changed member role" : "removed member",
        uid,
      );
    });
  }
}
