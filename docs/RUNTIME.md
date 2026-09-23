# Full IDE runtime implementation

## Boundaries

SyncStudio 3 adds an execution plane without replacing the existing collaborative database. Each `(project UUID, authenticated user UUID)` maps to a deterministic 32-character workspace key. The server derives this key; browser input cannot choose arbitrary containers, commands, images, volumes, or paths.

The workspace filesystem is authoritative inside that personal IDE. The shared Yjs tree is authoritative inside the collaborative editor. A first-start seed and an explicit reviewed import bridge these two contexts. Live simultaneous editing in code-server is not implemented.

The runner is a trusted control service with Docker socket access. It does not accept arbitrary Docker arguments over HTTP. The application API holds a randomly generated runner credential. Workspace containers never receive that credential, the Docker socket, the application database, or application AI keys. They run as UID 1000 with capabilities dropped, no-new-privileges, a read-only image filesystem, writable home, 512 MB temporary storage, 2 CPU / 2 GB RAM and a 256-process limit. There is no host port publication for an individual workspace. Each workspace network is separate; the runner joins it to proxy traffic.

This is a single-host trusted-team implementation. Public untrusted tenancy needs stronger isolation (dedicated VMs or a suitable sandbox runtime), egress/metadata filtering, per-user quotas, disk quotas, abuse handling, and hardened worker hosts. The Docker daemon remains host-privileged; treating the runner secret as ordinary client data would compromise that boundary. Docker volume disk usage is not quota-limited by this implementation.

## Browser access

App: `http://localhost:3001`; IDE: `http://KEY.localhost:3002`. Separate workspace hostnames avoid cross-workspace same-origin access. A single shared hostname with path-only isolation is not an equivalent deployment.

1. An authenticated project editor/owner requests a launch link.
2. API derives the workspace key and sends the session hash and authenticated identity to the runner over its private control API.
3. Runner issues a 60-second single-use ticket in a URL fragment. It is not sent in HTTP request URLs or normal request logs.
4. A minimal `/launch` page removes the fragment, exchanges the ticket using a same-origin POST, and sets a host-only HttpOnly SameSite Strict cookie. HTTPS deployments add Secure.
5. The gateway checks the session against the main API and current project role for every HTTP request and WebSocket handshake. Active WebSocket sessions are revalidated every five seconds; an authorization timeout fails closed. A disconnected or revoked client cannot create more terminals through that gateway.
6. The cookie and application session cookies are stripped before proxying to code-server. The upstream cannot set the reserved IDE session cookie.

IDE gateway sessions expire after eight hours. Runner restart drops in-memory launch tickets and gateway sessions; reopen from SyncStudio. Containers and their files persist. The runner reconnects to existing workspace networks after recreation. An open IDE WebSocket counts as active; a disconnected workspace stops after 30 minutes. Running background commands do not override that idle policy.

## Import correctness

Runner metadata stores the base semantic file-tree SHA-256. The API compares the shared file tree with that baseline before creating a review, validates filenames/parents/limits, and retains the immutable reviewed contents for 10 minutes. Import rechecks owner access and current file-tree hash inside the same project mutation queue used by collaborative writes. It creates a recovery snapshot, constructs new Yjs documents/file IDs, advances the epoch, clears comments, persists once, and resets connected collaboration clients. Old-generation offline edits cannot apply afterward.

A failed runner baseline update after a successful database import returns `baselineUpdated: false`; the UI explains that the import succeeded but the workspace should be recreated before another import. Reviews are transient and intentionally expire on API restart. If the shared tree changed before review, there is no automatic three-way merge: export the IDE work with Git/download, resolve deliberately, and recreate the personal environment.

File enumeration excludes symlinks, unsupported paths, binary files, large files, dependency/build directories, Git metadata and `.env*`. It uses no-follow file opens and has traversal and size checks. It reads saved filesystem contents, not unsaved IDE buffers. Concurrent terminal writes can still produce a mixed-time filesystem snapshot; stop writers/save files before reviewing. Imported content is exactly the content returned for that review.

## Runtime API

All `/api/projects/:id/runtime` operations require a valid app session and at least EDITOR. Mutation requests require the configured app Origin.

| Endpoint | Method | Meaning |
|---|---|---|
| `/api/runtime/options` | GET | Runtime configured and supported templates |
| `/api/projects/:id/runtime` | GET | Personal workspace state |
| `/api/projects/:id/runtime/start` | POST | `{template}`: web/python/cpp/java/go/rust; first seed or resume |
| `/api/projects/:id/runtime/launch` | POST | One-use IDE URL |
| `/api/projects/:id/runtime/stop` | POST | Stop processes; retain files |
| `/api/projects/:id/runtime/review` | POST | Owner-only source diff and excluded paths |
| `/api/projects/:id/runtime/import` | POST | Owner-only `{reviewId}` guarded import |
| `/api/projects/:id/runtime` | DELETE | `{confirmation:"DELETE WORKSPACE"}` removes personal volume/container |

Internal runner calls use bearer authentication on port 7000, not browser cookies. The app's `/internal/workspaces/authorize` endpoint also requires the runner secret. Do not route it publicly in a production reverse proxy. The local stack publishes only the app and IDE gateway on loopback. Project deletion asks the runner to remove its workspace volumes before deleting the shared project; if cleanup fails, deletion returns an error so the operator can retry.

## Hosting

The full application requires a Linux Docker host. A static host or Cloudflare Worker cannot run this runtime.

For HTTPS hosting, adapt `compose.ide.yaml` rather than publishing the local defaults unchanged:

- App: `NODE_ENV=production`, `CLIENT_URL=https://studio.example.com`.
- Runner: `IDE_PUBLIC_URL=https://ide.example.net`. Configure wildcard DNS and a wildcard TLS certificate for `*.ide.example.net`.
- Prefer an IDE parent domain separate from the main application domain. Keep gateway cookies host-only.
- Preserve the original `Host` on the reverse proxy and forward WebSocket upgrades. Route wildcard IDE traffic to runner port 3002, and app traffic to app port 3001. Keep runner port 7000 and Docker completely private.
- Back up the app database volume, runner metadata, and every `ss-home-*` volume. Stop writers for consistent backups. Never log the runner credential, auth cookies, or launch-ticket fragments.
- Keep a single API instance and runner. The current database queues and runtime metadata are not a distributed scheduler.

No HTTPS site or wildcard certificate was provisioned as part of this source delivery.

## Operations and recovery

```bash
docker compose -f compose.ide.yaml logs --tail=100 app runner
docker ps -a --filter label=syncstudio.workspace=true
docker logs ss-WORKSPACE_KEY
docker volume ls --filter name=ss-home-
```

Use Stop/Resume for normal lifecycle. Existing environment templates cannot change in place; export, explicitly delete the workspace, and create a new environment. `npm run ide:stop` stops dynamic containers before taking down the control services. A raw `docker compose down` does not manage dynamically created containers and can leave them running.

A changed toolchain image affects newly created containers. Preserve old home volumes and back them up before planned upgrades. The initial code-server version is pinned to 4.136.2. Node/Go/Rust image major tags and extension installations follow their upstream release streams; pin tested digests and extension versions when promoting an image to production. Build fails if an extension installation fails. Do not bypass the failure and claim that language support is installed.

## Official references

- [code-server FAQ and extension differences](https://coder.com/docs/code-server/FAQ)
- [Authenticated access, reverse proxy, and preview ports](https://coder.com/docs/code-server/guide)
- [Pinned code-server release](https://github.com/coder/code-server/releases/tag/v4.136.2)
