import { z } from "zod";
export const roleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export type Role = z.infer<typeof roleSchema>;
export interface User {
  id: string;
  username: string;
  email: string;
}
export interface Account extends User {
  passwordHash: string;
}
export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
}
export interface FileNode {
  id: string;
  path: string;
  type: "file" | "folder";
  content: string;
  state: string;
}
export interface Activity {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
}
export interface Comment {
  id: string;
  fileId: string;
  line: number;
  endLine: number;
  body: string;
  author: string;
  resolved: boolean;
  createdAt: string;
  replies: { author: string; body: string; createdAt: string }[];
}
export interface Version {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  files: FileNode[];
  changedFiles: number;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  template: Template;
  owner: string;
  members: Record<string, Role>;
  files: FileNode[];
  versions: Version[];
  comments: Comment[];
  activity: Activity[];
  epoch: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectSummary extends Pick<
  Project,
  | "id"
  | "name"
  | "description"
  | "template"
  | "owner"
  | "createdAt"
  | "updatedAt"
> {
  role: Role;
  memberCount: number;
}
export interface Workspace extends Omit<Project, "versions"> {
  role: Role;
  versions: Omit<Version, "files">[];
  people: (User & { role: Role })[];
}
export interface Presence {
  clientId: number;
  user: User & { color: string; colorLight: string };
  fileId: string;
  selection?: unknown;
}
export interface Reply<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}
export const templates = [
  "python",
  "c",
  "cpp",
  "java",
  "go",
  "rust",
  "vanilla",
  "react",
  "javascript",
  "typescript",
] as const;
export type Template = (typeof templates)[number];
export const registerSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[a-zA-Z0-9_-]+$/),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(10).max(128),
  })
  .strict();
export const loginSchema = registerSchema.pick({ email: true, password: true });
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).default(""),
    template: z.enum(templates).default("vanilla"),
  })
  .strict();
export const idSchema = z.uuid();
export const pathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.endsWith("/") &&
      !p.includes("\\") &&
      p
        .split("/")
        .every(
          (n) =>
            n !== "." &&
            n !== ".." &&
            n.length > 0 &&
            /^[a-zA-Z0-9_.@() -]+$/.test(n),
        ),
    "Use a relative path with valid file names",
  );
export const fileSchema = z
  .object({
    path: pathSchema,
    type: z.enum(["file", "folder"]).default("file"),
    content: z.string().max(200000).default(""),
  })
  .strict();
export const commentSchema = z
  .object({
    fileId: idSchema,
    line: z.number().int().min(1).max(100000),
    endLine: z.number().int().min(1).max(100000),
    body: z.string().trim().min(1).max(4000),
  })
  .refine((c) => c.endLine >= c.line);
export const events = {
  join: "project:join",
  sync: "document:sync",
  update: "document:update",
  awareness: "presence:update",
  presence: "presence:list",
  changed: "project:changed",
  reset: "project:reset",
  revoked: "project:revoked",
} as const;
export function language(path: string) {
  return (
    (
      {
        html: "html",
        css: "css",
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        json: "json",
        md: "markdown",
        py: "python",
        c: "c",
        h: "c",
        cpp: "cpp",
        hpp: "cpp",
        java: "java",
        go: "go",
        rs: "rust",
        sh: "shell",
        bash: "shell",
        sql: "sql",
        yaml: "yaml",
        yml: "yaml",
        toml: "ini",
        ini: "ini",
        rb: "ruby",
        php: "php",
        kt: "kotlin",
        swift: "swift",
        cs: "csharp",
        dockerfile: "dockerfile",
        svg: "xml",
      } as Record<string, string>
    )[(path.split("/").pop()?.split(".").pop() ?? "").toLowerCase()] ??
    "plaintext"
  );
}
