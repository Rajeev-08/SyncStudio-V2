import { useEffect, useRef } from "react";
interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
}
export function useFileTool(
  open: (id: string, line?: number) => void,
  files: { id: string; path: string; type: string }[],
) {
  const current = useRef({ open, files });
  current.current = { open, files };
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const tool: Tool = {
      name: "open_project_file",
      description:
        "Open an existing file in the current SyncStudio editor. Does not change file contents.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          line: { type: "integer", minimum: 1 },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input) {
        if (
          !input ||
          typeof input !== "object" ||
          !("path" in input) ||
          typeof input.path !== "string"
        )
          throw new Error("A file path is required.");
        const line = "line" in input ? input.line : 1;
        if (typeof line !== "number" || !Number.isInteger(line) || line < 1)
          throw new Error("Line must be a positive integer.");
        const file = current.current.files.find(
          (f) => f.path === input.path && f.type === "file",
        );
        if (!file) throw new Error("File not found in this workspace.");
        current.current.open(file.id, line);
        return { opened: file.path, line };
      },
    };
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch((error) =>
        console.error("File navigation tool could not register", error),
      );
    } catch (error) {
      console.error("File navigation tool could not register", error);
    }
    return () => lifecycle.abort();
  }, []);
}
