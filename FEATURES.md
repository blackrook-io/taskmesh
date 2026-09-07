# TaskMesh Features
A personal knowledge and work hub that unifies projects, ideas, tasks, documents, boards, and diagrams in one place. It is built for desktop and mobile, and is self-hosted with PostgreSQL — on bare-metal Ubuntu or Docker Compose (Windows, macOS, Linux) — so your data stays on your machine.

## Projects

- Turn Ideas into structured projects with Markdown overviews, tags, and status
- Enable only the modules you need per project: Tasks, Documents, To Dos, Boards, Wiki, Canvases, and Image Boards
- Drag to reorder projects in the left nav; pick projects quickly from a compact picker when the rail is collapsed
- Optional per-project color themes on top of the global accent theme



## Tasks

- Capture work as simple list lines, then expand into due dates, notes, priority, color, phase, and tags
- Organize with parent/child hierarchies, dependencies, phases, and filterable task groups
- Drag-and-drop reorder and group membership; right-click for quick state, priority, and due-date changes
- Track progress with states (Draft through Complete), activity history, and a visual change timeline
- Soft-delete with restore; move tasks between projects or keep them in a global Tasks view



## Ideas

- Park lightweight Markdown ideas with tags before they become real work
- Convert an idea into a Project or a To Do in one step



## Documents

- Store project documents as Markdown, EPUB, or PDF (large uploads supported)
- Edit Markdown in a TipTap WYSIWYG with preview, focus mode, tables, checklists, and image paste/resize
- Preview Mermaid diagrams inline from fenced code blocks
- Read EPUBs in-app with table of contents, page turn, font size, and dark/light reading modes
- Read PDFs in-app with page navigation, zoom, color-safe dark mode, and one-time password unlock (never stored)
- Cross-link records with typed references such as `#T0042` and `#N0012`



## To Do lists

- Build standalone checklists that can mix To Dos, Tasks, and Ideas
- Filter by state, priority, and tags; drag to reorder; color-code list accents



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

- Jump anywhere with ⌘K / Ctrl+K: recent items, live search hits, and quick actions
- Full-text search across ideas, projects, tasks, documents, boards, canvases, wiki, and lists
- Browse by tag; collapse or hide the left rail for more canvas space



## Tags & appearance

- Attach colored tags across record types for filtering and discovery
- Choose from six accent themes (green, blue, orange, yellow, purple, red)



## Assistant

- Optional OpenAI side panel for chat, research, and summarization with current-page context
- Propose creates and edits that apply only after you confirm



## Accounts & admin

- Email/password sign-in with secure session cookies and CSRF protection on mutations
- Personal API keys with read/write scopes and expiry
- Admin hub for users, keys, API usage, database stats, system logs, properties, and templates
- Ownership transfer and role labels for multi-user homes



## Backup & data

- Scheduled and on-demand backups of PostgreSQL plus uploaded files, with admin download of complete archives, restore, and safety dumps
- CSV export and insert-only CSV/XLSX import for projects and tasks
- Confirm before destructive deletes so accidents stay rare



## Install & hosting

- Choose bare-metal Ubuntu (systemd + nginx) or Docker Compose from INSTALL.md, with OS-specific container host steps and official docs links

