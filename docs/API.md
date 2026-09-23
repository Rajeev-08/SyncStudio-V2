> **SyncStudio 3:** This document describes the retained collaborative subsystem. See [RUNTIME.md](RUNTIME.md) for the new code-server runner, terminal, language environments, gateway, and guarded imports.

# HTTP and realtime contracts

All API responses are JSON. Errors use `{ "error": { "code": "PROJECT_FORBIDDEN", "message": "..." } }`. The response also has an `X-Request-ID`. List/detail responses are direct typed objects or arrays; mutations generally return `{ "ok": true }` or a created object. The browser uses same-origin credentials. Every non-read HTTP request must supply the configured `Origin`, including API examples run with curl.

| Method | Endpoint | Access | Body / result |
|---|---|---|---|
| GET | `/api/health` | Public | Health status |
| GET | `/api/auth/options` | Public | Whether demo access is enabled |
| POST | `/api/auth/register` | Public, rate-limited | username, email, password; sets session cookie |
| POST | `/api/auth/login` | Public, rate-limited | email, password; rotates current session |
| POST | `/api/auth/demo` | Only if explicitly enabled | Creates a real isolated demo account/project |
| GET | `/api/auth/me` | Session | id, username, email |
| POST | `/api/auth/logout` | Session | Revokes session and disconnects its sockets |
| GET | `/api/projects` | Session | Authorized project summaries |
| POST | `/api/projects` | Session | name, description?, template? |
| GET | `/api/projects/:id` | VIEWER+ | Files, roles, people, comments, versions metadata, activity |
| PATCH | `/api/projects/:id` | OWNER | name, description? |
| DELETE | `/api/projects/:id` | OWNER | Permanent project deletion |
| POST | `/api/projects/:id/duplicate` | VIEWER+ | Independent copy owned by caller |
| POST | `/api/projects/:id/files` | EDITOR+ | path, type?, content? |
| PATCH | `/api/projects/:id/files/:fileId` | EDITOR+ | path; renames/moves entire subtree |
| DELETE | `/api/projects/:id/files/:fileId` | EDITOR+ | Deletes node and slash-delimited descendants |
| POST | `/api/projects/:id/members` | OWNER | email, role: EDITOR or VIEWER |
| PATCH | `/api/projects/:id/members/:userId` | OWNER | role |
| DELETE | `/api/projects/:id/members/:userId` | OWNER | Removes member; owner immutable |
| POST | `/api/projects/:id/versions` | EDITOR+ | message; snapshot of persisted files |
| GET | `/api/projects/:id/versions/:versionId` | VIEWER+ | Snapshot with complete files |
| DELETE | `/api/projects/:id/versions/:versionId` | OWNER | Remove snapshot to reclaim space |
| POST | `/api/projects/:id/versions/:versionId/restore` | OWNER | Recovery snapshot + restore; returns epoch |
| POST | `/api/projects/:id/comments` | EDITOR+ | fileId, line, endLine, body |
| PATCH | `/api/projects/:id/comments/:commentId` | EDITOR+ | reply?, resolved? |
| GET | `/api/ai/status` | Session | enabled flag |
| POST | `/api/projects/:id/ai` | VIEWER+, rate-limited | fileId, question, selection?; explanation, code?, baseContent |

There is intentionally no REST “replace file text” endpoint. Text mutations use the CRDT channel so an HTTP save cannot bypass collaborative state.

## Common errors

400 VALIDATION_ERROR / INVALID_EVENT; 401 UNAUTHENTICATED / SESSION_EXPIRED / INVALID_CREDENTIALS; 403 PROJECT_FORBIDDEN / ROLE_FORBIDDEN / ORIGIN_FORBIDDEN; 404 NOT_FOUND / USER_NOT_FOUND; 409 PATH_EXISTS / ACCOUNT_EXISTS / STALE_EPOCH; 422 INVALID_PARENT / INVALID_MOVE / FILE_LIMIT / DOCUMENT_LIMIT / PROJECT_LIMIT / VERSION_LIMIT; 429 RATE_LIMIT; 502 AI_PROVIDER_ERROR / AI_INVALID_RESPONSE / AI_UNAVAILABLE; 503 AI_NOT_CONFIGURED.

## Socket events

Client requests use acknowledgement `{ok:true,data:...}` or `{ok:false,error:{code,message}}`. Binary fields are Uint8Array / Socket.IO binary payloads. Event constants live in `packages/shared/src/index.ts`.

| Event | Direction | Payload / behavior |
|---|---|---|
| `project:join` | Request | projectId; session + membership check, leave previous project room |
| `document:sync` | Request | projectId, fileId, epoch, vector; returns missing update and server vector |
| `document:update` | Request | projectId, fileId, epoch, update; EDITOR+, joined room, bounded binary, durable acknowledgement |
| `document:update` | Server broadcast | fileId, epoch, update; peers merge with `Y.applyUpdate` |
| `presence:update` | Request | scope, Yjs clientId, nullable relative selection; identity supplied by server |
| `presence:list` | Server broadcast | Connected presence list with authoritative user/color |
| `project:changed` | Server broadcast | Re-fetch structural project metadata |
| `project:reset` | Server broadcast | Restore/delete notification; re-fetch generation |
| `project:revoked` | Server to affected client | Role/access changed; disconnect/reopen workspace |

Limits: 300 KB Socket.IO packet envelope, 256 KB single binary request, 600 events per 10 seconds per socket, 4 KB selection serialization. Normal typing is debounced into merged updates. File sizes and total persisted project bytes have separate limits.
