import { describe, it, expect } from "vitest";
import { resolvePath } from "../apps/web/src/lib/preview";
import { buildContext } from "../apps/api/src/ai";
import { SqliteStore } from "../apps/api/src/store";
import { ProjectService } from "../apps/api/src/service";
import { pathSchema } from "../packages/shared/src/index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("preview paths and bounded context", () => {
  it("resolves relative nested modules and extension inference", () => {
    expect(resolvePath("src/App.jsx", "./utils", ["src/utils.ts"])).toBe(
      "src/utils.ts",
    );
    expect(resolvePath("src/App.jsx", "../styles.css", ["styles.css"])).toBe(
      "styles.css",
    );
  });
  it("rejects unknown packages and missing files", () => {
    expect(() => resolvePath("src/app.js", "lodash", [])).toThrow(
      "not available",
    );
    expect(() => resolvePath("src/app.js", "./missing", [])).toThrow(
      "Cannot resolve",
    );
  });
  it("rejects unsafe filesystem paths", () => {
    for (const path of [
      "../secret",
      "/absolute",
      "a//b",
      "a/../b",
      "a\\b",
      "<script>",
    ])
      expect(pathSchema.safeParse(path).success).toBe(false);
  });
  it("persists project data across store restarts and caps AI context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "syncstudio-"));
    const path = join(dir, "db.sqlite");
    let store = new SqliteStore(path);
    const service = new ProjectService(store);
    const user = {
      id: crypto.randomUUID(),
      username: "author",
      email: "author@example.com",
    };
    const p = await service.create(user, {
      name: "Durable",
      description: "",
      template: "vanilla",
    });
    await service.createFile(p.id, user, {
      path: "large.ts",
      type: "file",
      content: "a".repeat(40000),
    });
    await store.close();
    store = new SqliteStore(path);
    const saved = await store.project(p.id);
    expect(saved?.name).toBe("Durable");
    const f = saved!.files.find((f) => f.path === "large.ts")!;
    expect(buildContext(saved!, f.id, "").current.content.length).toBe(20000);
    await store.close();
    rmSync(dir, { recursive: true });
  });
});
