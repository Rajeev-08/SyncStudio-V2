import { createHash } from "node:crypto";
import { z } from "zod";
import { fileSchema } from "./index";
export const runtimeTemplates = [
  "web",
  "python",
  "cpp",
  "java",
  "go",
  "rust",
] as const;
export const runtimeFilesSchema = z
  .array(fileSchema)
  .max(150)
  .superRefine((files, ctx) => {
    const paths = new Map(files.map((f) => [f.path, f.type]));
    if (paths.size !== files.length)
      ctx.addIssue({ code: "custom", message: "Duplicate paths" });
    for (const f of files) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++)
        if (paths.get(parts.slice(0, i).join("/")) !== "folder")
          ctx.addIssue({ code: "custom", message: "Missing parent folder" });
    }
    if (Buffer.byteLength(JSON.stringify(files)) > 2_000_000)
      ctx.addIssue({ code: "custom", message: "Import exceeds 2 MB" });
  });
export type RuntimeFile = z.infer<typeof fileSchema>;
export function treeHash(files: RuntimeFile[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        files
          .map(({ path, type, content }) => ({ path, type, content }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      ),
    )
    .digest("hex");
}
export function workspaceKey(projectId: string, userId: string) {
  return createHash("sha256")
    .update(projectId + ":" + userId)
    .digest("hex")
    .slice(0, 32);
}
