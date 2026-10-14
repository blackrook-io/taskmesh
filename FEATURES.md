# TaskMesh Features
A personal knowledge and work hub that unifies projects, ideas, tasks, documents, boards, and diagrams in one place. It is built for desktop and mobile, and is self-hosted with PostgreSQL — on bare-metal Ubuntu or Docker Compose (Windows, macOS, Linux) — so your data stays on your machine.

## Projects

- Turn Ideas into structured projects with Markdown overviews, tags, and status
- Project Overview dashboard with a pinned description (Owners and Managers can edit it) and a personalizable panel canvas (add/remove/rearrange, project default + Reset, including My Tasks Today); click a panel row to open that Task or To Do
- Enable only the modules you need per project: Tasks, Documents, To Dos, Boards, Wiki, Canvases, Mesh, and Image Boards
- Open Mesh to see the focused record centered over its contents, with its own links beside it and links from inside on a rail
- Switch Mesh to Plan view to read dependencies and parent/child links left to right, one row per phase, and see which Ready work is next or still blocked
- Drag a Mesh node to pin it; the position and the canvas pan and zoom return for that record and view, and Reset layout clears them
- Color Mesh by type, state, or priority, and see overdue, at-risk, stale, and depends-on signals on the cascade
- Hover a Mesh record to read its state, due date, last change, contents, blockers, and links without leaving the cascade
- Administrators set Mesh colors and readability for everyone: record colors, suggestion and signal colors, line weight, size, label halo, overdue pulse, and how soon a quiet record counts as stale
- On a Task, To Do, Idea, or Document, see what it links to and what links to it, and add or remove a manual link
- Single left rail with projects and nested modules under the active project; pick projects quickly from a compact picker when the rail is collapsed
- Optional per-project color themes on top of the global accent theme
- Assign users to Managers, Members, and Viewers per project — Managers and Owners get Settings; Members write; Viewers read-only
- Organize people into User Groups (G####) from Administration, assign platform Roles to Groups, and add Groups to project role lists with live membership expansion



## Tasks

- Capture work as simple list lines, then expand into due dates, notes, priority, color, phase, and tags
- Organize with parent/child hierarchies, dependencies, phases, and filterable task groups
- Drag-and-drop reorder and group membership; right-click for quick state, priority, and due-date changes
- Personalize List View columns from the header context menu — show, hide, and reorder fields with a server-saved layout shared across projects
- Collapsed Task Groups and parent tasks stay closed across refreshes and browsers
- Track progress along a fixed path from Draft to Complete, with a comment required to cancel, reopen, or return In Progress to Ready, activity history, and a visual change timeline
- Setting a Draft or In Progress task to Ready while prerequisites are still open stores it as Blocked until every prerequisite is finished; you can return it to Draft or cancel it
- Soft-delete with restore; move tasks between projects or keep them in a global Tasks view
- Assign project Tasks (and ToDos) to Owners, Managers, or Members from the list context menu or edit form
- Completed rows grey out so finished work is easier to scan past



## Ideas

- Park lightweight Markdown ideas with tags before they become real work
- Drag to reorder the Ideas list, or sort by column and return to that saved order; filter by title, tags, dates, and assignee
- Personalize the Ideas list columns the same way as Tasks (server-saved layout)
- Convert an idea into a Project or a To Do in one step



## Documents

- Store project documents as Markdown, EPUB, or PDF (large uploads supported)
- Edit Markdown in a TipTap WYSIWYG with preview, focus mode, tables, checklists, and image paste/resize
- Preview Mermaid diagrams inline from fenced code blocks
- Read EPUBs in-app with table of contents, page turn, font size, and dark/light reading modes
- Read PDFs in-app with page navigation, zoom, color-safe dark mode, and one-time password unlock (never stored)
- Cross-link records with typed references such as `#T0042` and `#N0012`
- Saving a mention in a task, to-do, idea, or document stores a link, and removing the mention removes that link



## To Do lists

- Comment on a To Do or on the list itself, using the same History editor as a Task; an Administrator can delete a comment
- Build standalone checklists that can mix To Dos, Tasks, and Ideas
- Filter by state, priority, and tags; drag to reorder, or sort by column and return to that saved order; personalize columns from the header; color-code list accents
- See To Do progress on the list as a color bar (red, orange, yellow, green); 100% marks the ToDo complete
- Nest To Dos on a list and see a parent’s x-of-y completion; marking a parent complete while a sub-item is open leaves it Pending until those sub-items finish



## Kanban boards & Drawing Canvases

- Run multiple Kanban boards per project with editable columns, lanes, and drag-and-drop cards
- Drop Tasks, Ideas, or To Do lists onto the same board
- Sketch freely with Excalidraw canvases — architecture templates, ERD helpers, grid assist, and SVG/PNG export
- Build image boards: infinite pan/zoom, paste or drop images, text, labeled boxes, and z-order control



## Wiki

- Nest Markdown pages and canvases in a drag-and-drop table of contents
- Surface Markdown, EPUB, or PDF document bodies inside the wiki without duplicating files
- Ability to reference other records directly from within Markdown documents using a shorthand cross-linking methodology



## Search & navigation

- Administrators jump anywhere with ⌘K / Ctrl+K: recent items, live search hits, and quick actions
- Search titles, notes, comments, and extracted PDF or EPUB text, and still find a record by its number such as T0208
- Browse by tag; collapse or hide the left rail for more canvas space



## Tags & appearance

- Attach colored tags across record types for filtering and discovery
- Choose from six accent themes (green, blue, orange, yellow, purple, red)



## Assistant

- Optional OpenAI side panel for chat, research, and summarization with current-page context
- Administrators enable AI providers from Administration → AI and set each provider's public https address and default model
- Set assistant permission tiers, web access, the project AI default, and usage budgets in Administration → AI, and review the AI audit log with filters and a CSV export
- Store an encrypted instance key per provider. Choose instance only, user only, or user preferred with instance fallback. On a multi-user instance, a mode that spends the instance key requires a typed confirmation
- The assistant uses your own provider key when the key mode says so. The AI button stays visible and says why AI is off: no provider key, turned off by an Administrator, you turned it off, or this project is excluded
- In Settings → Assistant, save your own provider key, pick a model with a right-size recommendation, turn the assistant off, and raise or switch off permission cells. You cannot enable anything an Administrator has disabled
- Write AI instructions for the instance, a project, or yourself. Context for a record includes those instructions, the record, its parent and links, recent activity, and search hits, each cited by its display number
- The assistant picks a model that can use tools and falls back to the next provider when the first is rate-limited, over quota, unreachable, or rejects the key
- Enable Anthropic for assistant chat. An environment key remains the fallback when no instance key is stored
- Enable Google Gemini for assistant chat and embeddings. An environment key remains the fallback when no instance key is stored
- Enable Azure OpenAI for assistant chat and embeddings. Set the resource endpoint, deployment names, and API version. An environment key remains the fallback when no instance key is stored
- Enable Ollama for local assistant chat and embeddings. Set a private or loopback address, a chat model, and an embedding model. No API key is required
- Index record text for keyword and meaning with the local Ollama model. Projects excluded from AI are not embedded, and Administrators can rebuild the index from Jobs
- Set a project to full, read-only, or excluded from AI. Owners and managers can only narrow the Administrator default, and an excluded project is never sent to a model
- Mark a project so AI uses local models only. Owners and managers can only turn that on, an Administrator can require it for every project, and a local error does not fall through to a cloud model
- Confirm ordinary assistant edits one at a time. Riskier or bulk changes open a review list where you check each item before anything is saved, and an edit expires if the record changed
- Opt in so the assistant applies tags, links, comments, and task dependencies immediately, then undo them from a toast or the AI activity page for 7 days
- Ask the assistant about todos, lists, links, tags, comments, task dependencies, and the records around one item. Proposed adds still wait for your confirmation
- Rate an assistant reply with thumbs up or down and an optional note. Administrators see accept, dismiss, and thumb rates by feature and model
- See today's AI token use, and estimated instance-key spend when a call uses that key. Administrators set daily token and spend caps plus how many tool calls or writes one reply may make. At 80% you get a warning; at the cap the assistant stops



## Accounts & admin

- Email/password sign-in with secure session cookies and CSRF protection on mutations
- An expired session sends you to sign-in and returns you to the same page after you log in
- Optional Google, Apple, and GitHub sign-in (OIDC / OAuth) with Admin-managed providers and Profile linked accounts
- Optional authenticator-app MFA (TOTP) with Admin enforcement for Administrators, enrollment grace period, and Profile setup
- Single-use MFA backup codes (shown once at enroll / regenerate) so you can sign in without your authenticator
- Trusted devices that skip MFA for a configurable number of days, with Profile revoke-all and Admin duration/max settings
- Personal API keys with read/write scopes and expiry
- Admin hub for users, groups, keys, OAuth providers, API usage, database stats, background jobs, system logs, properties, and templates
- See queue depth and failed background jobs, then retry a failure or delete it after confirming
- Administrators rename a user by double-clicking the display name; display names stay unique
- Project Settings (modules, phases, and users) is available to Managers and Owners; deleting a project stays Administrator-only
- Removing a Manager or Member who still has assigned work requires reassigning those items or clearing the assignee first
- Ownership transfer and role labels for multi-user homes



## Backup & data

- Scheduled and on-demand backups of PostgreSQL plus uploaded files, with admin download of complete archives, restore, and safety dumps
- CSV export and insert-only CSV/XLSX import for projects and tasks
- Per-user upload storage quota (default 5 GiB) so one account cannot fill the disk without bound
- Confirm before destructive deletes so accidents stay rare



## Install & hosting

- Choose bare-metal Ubuntu (systemd + nginx) or Docker Compose from INSTALL.md, with OS-specific container host steps and official docs links
- Guided public-host installer asks for the site name and administrator account, then publishes HTTPS with Let's Encrypt alongside your other nginx sites
- Administrators see an Update link beside the version when a newer stable GitHub Release exists; it opens that changelog and does not install the upgrade
- Upgrade an existing install from UPGRADES.md: back up first, then read that release for breaking changes

