# SyncStudio 3.2 validation

This release adds the full-runtime Terminal entry point, Docker prerequisite diagnostics, one-command startup with API health checks, tmux in the workspace image, and container PTY/tmux acceptance checks. Docker is not installed in the delivery environment; the doctor command correctly reports the missing prerequisite. Container builds, the new Docker acceptance checks and full terminal browser interaction remain unverified here. `npm run check` passed (59 tests, lint, strict TypeScript and production build). The container PTY probe was separately executed successfully on local Linux. The existing local real-PTY tests continue to run in the ordinary suite.

# SyncStudio 3.1 verification — 2026-09-12

`npm run check` passed: lint, **59 tests across 7 files**, strict TypeScript, web/API/runner builds. Twelve new integration tests exercise local tools, including actual Python input, GCC/G++ compilation, Java execution, Node JavaScript/TypeScript, native PTY shell input/resizing, Stop, stale document protection, and revoked-session disconnect. Authentication, operator/ownership/origin checks and child environment filtering are covered.

Executed on Linux with Node 24. Windows PowerShell/ConPTY was not executed. Go and Rust execution was not tested because their toolchains were unavailable. The optional node-pty module successfully compiled and executed here; it may need native build prerequisites on the target machine. The build still reports a large lazy-loaded Monaco workspace chunk.

Browser UI validation was attempted, but the browser could not connect to the workspace server. The new panels have not been visually verified in this environment.

The earlier Docker limitations below remain applicable only to the optional code-server path.

---

# SyncStudio 3 verification

Current source verification completed during this update:

| Gate | Result |
|---|---|
| ESLint | Passed |
| Strict TypeScript | Passed |
| Automated tests | **47 passed across six files** |
| Vite production frontend build | Passed |
| API and runner server builds | Passed |
| Full Docker image/Compose execution | **Not run**: Docker binary and daemon unavailable |
| Real code-server UI, extensions, language debugger sessions | **Not run** in this environment |
| Real Docker smoke test | Implemented as `npm run test:ide`, not executed here |
| Updated full-IDE control UI browser QA | Not run in this update |
| Live AI | Not verified; requires a provider key |

The 17 added tests exercise real HTTP services and file-helper processes where possible. Ten runtime API/gateway tests cover session/role/origin checks, single-use tickets, credential stripping, host isolation, review/import, conflict protection, persistent-workspace contracts, deletion confirmation, raw WebSocket forwarding, and closure after session revocation. Three filesystem tests execute the real seed/export helper against temporary directories, including symlink, binary, dependency, secret-file, and traversal cases. Four provisioning tests inspect Docker command construction, runner network reconnection, template ownership invariants, and cleanup using an explicit Docker test double.

The gateway tests proxy to a local test server; they do not run code-server. Docker provisioning tests use a Docker test double; they do not prove the Docker image builds. The other 30 tests retain the real HTTP/Socket.IO collaboration and database/API checks from v2. The production build reports a large Monaco workspace chunk warning; it is lazy-loaded after the dashboard.

The `Full IDE runtime acceptance` workflow in `.github/workflows/ide.yml` builds all images and runs the supplied smoke test on a Docker-enabled runner when manually dispatched. It checks installed compilers/interpreters, actual Python execution, authenticated workbench HTTP, file review/import and restart persistence. It does not replace hands-on debugger, extension, terminal UI, or preview acceptance checks. No workflow was triggered remotely during this delivery.

## Required target-host acceptance

1. Run the complete setup in README.md and `npm run test:ide`.
2. Open each language environment; use the integrated terminal and the supplied debug configuration. Verify breakpoints and variable inspection.
3. In a web workspace run `npm install && npm run dev`, open `/absproxy/5173/`, and verify assets, edits, and hot reload.
4. Install an Open VSX extension and verify it survives Stop/Resume.
5. Review/import a saved edit; verify the shared editor and recovery snapshot. Repeat after a concurrent shared edit and confirm conflict rejection.
6. Revoke a collaborator and verify their live IDE connection closes. Test HTTPS/host routing if deploying beyond localhost.

## Historical collaborative-editor verification

The following retained record describes v2 browser and optional-adapter checks, not a new v3 browser run.

# Verification record

The following is a record of this delivery, not a claim that an external deployment or GitHub Actions run has occurred.

| Check | Result |
|---|---|
| Dependency installation | `npm install` succeeded and lockfile included |
| ESLint | Passed against authored API, web, shared and test source |
| TypeScript | Strict `tsc --noEmit` passed |
| REST / socket / core tests | 27 tests passed |
| AI adapter contract tests | 3 tests passed using a local HTTP test provider |
| Production compilation | Vite frontend and bundled Node API built successfully |
| Browser demo flow | Real demo account/project created through backend |
| Monaco | Loaded source, accepted edits, showed saved status |
| Two browser sessions | Same account in two tabs; text synchronized and remote cursor/name visible |
| Distinct account permissions / convergence | Verified through authenticated integration clients, including owner, editor, viewer and outsider |
| Eight-client CRDT stress case | Concurrent markers converged exactly once; offline update replay persisted |
| Preview / console | Vanilla and React previews rendered; both counters executed; vanilla runtime log received by parent |
| History | Snapshot created through UI; Monaco diff rendered; restore returned original file tree |
| Nested files | Folder and nested file created through UI |
| Mongo-specific suite | Could not execute: mongod exits with `open: Operation not permitted` in this environment |
| Docker runtime | Not available in this environment; Dockerfile and Compose configuration supplied |
| Playwright independent-context suite | Supplied for local/CI execution; not run here through the restricted browser environment |
| Live AI provider | Not verified: no provider API key supplied; missing-key and provider-contract paths tested |
| Optional WebMCP file navigation | Registered conditionally; browser modelContext unavailable for validation here |
| GitHub Actions | Workflow supplied; no workflow run was triggered or claimed |

Browser tests used disposable real project records, not mock API responses. The automated integration suite creates a fresh SQLite database and real HTTP/WebSocket server, uses hashed passwords and real cookies, and verifies server-side denials. The AI tests deliberately use a test provider; those outputs are never shipped as product answers.

## Run the gates

```bash
npm ci
npm run check
npm run test:mongo
npx playwright install chromium
npm run test:e2e
```

For an existing Mongo test instance, set `MONGO_TEST_URI` to an isolated test database. Otherwise the Mongo suite starts an ephemeral mongodb-memory-server process and may download a Mongo binary. This requires an environment that permits running mongod.

`npm run test:e2e` starts the built app on port 3001 with a dedicated `.data/e2e.db`. Stop a local app already using that port first. The suite creates distinct isolated browser contexts and accounts, then exercises collaboration, presence, preview, history, unauthorized access, nested explorer, tabs and search. It is a separate gate from `npm test` because it needs an installed browser and built artifacts. CI runs all gates; failures are not ignored.

## Manual remaining checks before a public deployment

Run Docker and Mongo gates on your own machine or CI. Configure the intended AI provider and verify an explanation, a code diff and Apply. Test restore while another user is offline, compare the recovery snapshot, and confirm permissions after reconnect. Use an HTTPS same-origin deployment and confirm Secure cookies and WebSocket proxying. Back up the chosen persistent database and keep the deployment to one API instance.
