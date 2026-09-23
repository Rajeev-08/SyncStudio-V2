import type { Reply } from "../../../../packages/shared/src/index";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "The server returned an invalid response.",
      res.status,
    );
  }
  if (!res.ok) {
    const e = data as Reply;
    throw new ApiError(
      e.error?.code ?? "REQUEST_FAILED",
      e.error?.message ?? "Request failed.",
      res.status,
    );
  }
  return data as T;
}
export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
