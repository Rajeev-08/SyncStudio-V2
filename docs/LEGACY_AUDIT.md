# Audit of the supplied SyncStudio source

The rebuild was based on the 54-file repository export supplied with this request, not an assertion that the live GitHub branch has the same contents. The original source remains untouched in the user's attachment. No changes were pushed to GitHub.

## Existing architecture

React/JavaScript + Vite and Tailwind; a large Workspace page maintained files, editor text, dirty flags, versions, activities and members. Monaco edits were sent through a global Socket.IO connection. Express controllers called Mongoose models directly. Users had seven-day bearer JWTs stored in localStorage. Projects stored owner and an untyped member-ID array. Files stored parent references, paths and content. Versions copied selected file fields. An iframe preview combined the first HTML, CSS and JS files.

| Finding | Evidence in supplied source | Rebuild response |
|---|---|---|
| Critical: unauthenticated socket joins and broadcasts | `server/src/sockets/socketHandler.js` joins arbitrary project IDs and forwards client identity/content | Session handshake, allowed origin, membership and role checks on every sensitive event |
| Critical: cross-project HTTP access | File, version, activity and member controllers require a JWT but do not consistently check membership | Central authorization service used by every project route |
| Critical: concurrent edit overwrite | `file-edit` carries complete text and `CodeEditor` replaces content | Yjs binary updates, state-vector synchronization, Monaco binding |
| High: unsafe restore | Delete all files then insert replacements without recovery; copied parent IDs no longer identify inserted folders | One atomic aggregate update, automatic recovery snapshot, canonical paths, new document generation |
| High: insecure session persistence | `AuthContext` stores bearer tokens in localStorage for seven days | HttpOnly SameSite cookie with a hashed, revocable server session |
| High: cross-project parent references | File creation looks up parent without verifying project or folder type | Canonical relative paths and parent-folder verification inside the authorized project |
| High: regex-based recursive delete | File path interpolated into a regular expression | Exact path equality or slash-delimited prefix checks |
| High: missing validation | Input shapes and IDs used directly; generic 500 responses | Shared Zod schemas, size limits, structured error codes |
| High: no role model | Any member can effectively invite, restore or mutate | OWNER / EDITOR / VIEWER with server-side rules |
| Medium: refetch on each edit | `fetchWorkspaceMeta` depends on `editorContent`, and the effect depends on that callback | Query metadata only on structural changes; document state stays in Yjs |
| Medium: fragile dirty-state merging | Multiple local copies of file/editor state and refs | One Y.Text per file, pending update queues and persistence acknowledgements |
| Medium: listener ownership | Global socket and broad `off(event)` calls remove others' handlers | One provider per workspace lifetime; exact event handling and teardown |
| Medium: preview assumptions | `find` selects first file of each extension; linked dependencies ignored | Resolve entry HTML, linked styles, relative modules, TS/JSX, supported React runtime |
| Medium: no tests | Server `test` script deliberately exits with failure | REST, authorization, socket, convergence, persistence, AI contract and preview tests; browser and Mongo gates |
| UX / maintainability | Duplicate VersionList/VersionPanel; unused ProjectCard, CSS boilerplate, elaborate labels | Feature components, shared primitives, conventional IDE labels, formatter |

## Migration decisions

This is a replacement application with an explicit import boundary, not an in-place database migration. Old JWTs and snapshots are not accepted. Preserve a backup of the old database. Register accounts in the new app, recreate roles deliberately, and copy/export source files into new projects. The previous parent-reference snapshots are not trustworthy enough for an automatic blind conversion.

Useful concepts retained: projects, nested explorer, Monaco, preview, members, activities and snapshots. The transport, authorization, session lifecycle, filesystem validation and restore strategy were rebuilt.
