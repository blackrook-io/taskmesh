# Release notes

Human-readable notes for each finished TaskMesh version. Updated on every **finish up** in the same commit as the SemVer bump. Newest version blocks appear first (directly under this intro).

A future **Build release** skill will use this file to populate GitHub Release notes. After that publish clears or archives the working notes, the next finish-up must recreate this file from the stub below if it is missing or empty (header only — no version blocks), then prepend the new version entry.

## 0.96.0 — 2026-10-21

### New Functionality
- Administrators configure outbound mail: server, port, encryption, account, sender name, and From address, then send a test message. Each attempt is logged without the message body, and Administration graphs sends, failures, and retries.
- When email self-signup is on, a person can create an account from the login page. The confirmation link activates it, and until then that account cannot sign in.
- Notification settings cover digest, reminder, mention, and assignment, each with in-app or email delivery, frequency, and quiet hours. Due-date and action-by reminders send on the shared job queue, and each email type can be unsubscribed in one click. The inbox shows Unread and Read.
- Each stored attention digest can be emailed through those settings. Links in the message open the records in the app, and the message can change how often it is sent or unsubscribe.

### Fixes
- Outbound mail uses Nodemailer 10.1.7. That release closes the high-severity address-parser advisory present in 7.x.

## 0.95.3 — 2026-10-21

### Fixes
- Each Task in an epic still gets its own interview and plan approval. Starting the epic confirms who ships together and opens the shared branch. The member chat writes that Task’s plan and waits for approval before editing code.

## 0.95.2 — 2026-10-21

### Enhancements
- Related Tasks can ship as one epic. Starting an epic confirms which children of a parent Task share one branch. Each child is implemented and QA’d in its own chat, and finishing the epic publishes one version and one pull request. A Task that is not in an epic still finishes up on its own.

## 0.95.1 — 2026-10-21

### Fixes
- An expired or invalid session sends you to the login page, with a return path and a centered two-line notice, instead of leaving “Authentication required.” on the page you were using. Signing in brings you back. A wrong password and an explicit log out stay on the login form without that notice.

## 0.95.0 — 2026-10-19

Release candidate for testers, published as pre-release `v0.95.0-rc1`. This summarizes everything shipped after `v0.50.0-beta` (app `0.50.0`). The in-app Update link ignores pre-releases.

### New Functionality
- Plans can be turned on per project. A plan board groups Tasks and ToDos into phases, shows hours and progress, and can be reordered without placing a dependent above its prerequisite. The board shows a finish-date range, a read-only timeline, and an optional AI refinement that sits beside the baseline.
- Mesh opens a focused record over its contents, with pins, color modes, dependency signals, and hover cards. Records can be linked (relates to, references, supports, or part of). Suggested links offer a match percent and a reason.
- The assistant can use OpenAI, Anthropic, Gemini, Azure OpenAI, or local Ollama. Keys are encrypted. A project can be full, read-only, excluded, or local-models only. Chat can capture tasks, suggest tags, warn about duplicates, answer a project question with citations, and build an attention digest.
- Tasks and ToDos store a quarter-hour Hours estimate and a Start date. Task lists can hide completed work, and a parent row shows its done/total count. Project Overview includes Next Up for work assigned to you.

### Breaking Changes
- TaskMesh requires Node.js 24 or newer. Node 22 is no longer supported.
- Migrations run through `0086`. A bare-metal database needs the PostgreSQL `vector` extension before migrate. Docker Compose already includes it.
- Saved Mesh layouts for the retired Plan view are removed. The layouts API accepts only the Focus view.
- An `UPLOAD_DIR` under a hidden directory returns 404, because Express 5 `res.sendFile` refuses a path segment that starts with `.`.

## 0.90.8 — 2026-10-19

### Enhancements
- Root and client `@types/node` are 24.19.2. Security CI, the digest-pinned Docker images, and the Ubuntu installer all use Node 24. The shared package upgrade script installs both type packages with Express 5.3, TypeScript 7, and dotenv 18.

### Breaking Changes
- TaskMesh requires Node.js 24 or newer. Node 22 is no longer supported. INSTALL and UPGRADES describe the NodeSource 24.x upgrade.

## 0.90.7 — 2026-10-19

### Enhancements
- Root and client `@types/node` are 22.20.5, aligned with the Node 22 runtime. The shared package upgrade script installs both copies with Express 5.3, TypeScript 7, and dotenv 18. Security CI runs on Node 22.

### Breaking Changes
- TaskMesh requires Node.js 22 or newer. INSTALL and UPGRADES state that minimum.

## 0.90.6 — 2026-10-19

### Enhancements
- The API loads environment variables with dotenv 18.0.8. Startup, migrate, and backup no longer print the injected-env line. The shared package upgrade script installs dotenv 18 with Express 5.3 and TypeScript 7.

## 0.90.5 — 2026-10-19

### Enhancements
- The API compiles with TypeScript 7.0.2. Server and AI-provider configs list Node types explicitly. The shared package upgrade script installs Express 5.3 and TypeScript 7 together. The client stays on TypeScript 6.

## 0.90.4 — 2026-10-19

### Enhancements
- The API runs on Express 5.3. Query-string HTML is still stripped, and a failed listen still exits before background jobs start. Upload downloads keep the filename header. An `UPLOAD_DIR` under a hidden directory returns 404, which INSTALL and UPGRADES now describe.

## 0.90.3 — 2026-10-19

### Fixes
- A failed API listen logs the error and exits before system properties, the job queue, document extraction, or the knowledge index start. Under Express 5 that covers a port that is already in use.

## 0.90.2 — 2026-10-19

### Fixes
- Query-string sanitizing replaces `req.query` instead of assigning it. HTML in query values is still stripped, and the same path does not throw when `req.query` is a getter.

## 0.90.1 — 2026-10-19

### Enhancements
- Project Overview’s Next Up panel lists incomplete Tasks and ToDos assigned to you that are due in the next few days. The window starts at three days, including today, and you can change it. Layouts that already had My Tasks Today keep the same panel.

## 0.90.0 — 2026-10-19

### New Functionality
- Task lists have a Hide completed control beside Filter. It hides Complete and Canceled tasks at every level, including a parent whose descendants are all closed, and keeps a parent that still has open work. Progress counts stay the same, and the progress tooltip says how many closed tasks are hidden. The choice is saved for that user. Turning it off shows each group and parent as expanded or collapsed as before.

## 0.89.3 — 2026-10-19

### Enhancements
- Task lists no longer show the rounded status box beside each row. State stays in the State column, right-click Set state still changes it, and completed rows stay dimmed.

## 0.89.2 — 2026-10-19

### Enhancements
- A parent row in the task list shows its done/total count and progress bar beside the chevron, whether the group is expanded or collapsed. The count and bar no longer repeat next to the title.

## 0.89.1 — 2026-10-19

### Fixes
- Pasting Markdown into a Document keeps text that is both bold and inline code. A paste of that combination no longer disappears.

## 0.89.0 — 2026-10-15

### Enhancements
- Mesh no longer has a Plan view. A Task or ToDo on a Mesh card lists each plan it belongs to, and Open in plan opens that plan’s Timeline. Opening a plan from the project rail or from the record’s Plans field still shows the Board.

### Breaking Changes
- Saved Mesh layouts for the retired Plan view are removed. The layouts API accepts only the Focus view.

## 0.88.0 — 2026-10-15

### New Functionality
- A plan board can refine its finish with AI. The range sits beside the baseline, with the reasons behind it, and you can mark whether it helped. The baseline dates stay as they are. A result outside the sanity window is discarded and recorded in the AI audit log. The same inputs reuse the last accepted range until the board changes.
- The assistant can read a plan, add Tasks and ToDos, reorder it, and change item state. Those writes save immediately. A project excluded from AI gets neither the tools nor the forecast. A read-only project can be read and refined without sending item titles.

### Enhancements
- The AI forecast card uses the same corner radius as the rest of the theme.

## 0.87.7 — 2026-10-15

### New Functionality
- A plan can switch from the board to a read-only timeline. Each Task and ToDo is a bar scheduled from its hours, start date, and dependencies, so a dependent never starts before its prerequisite ends. When start dates do not delay the work, the critical chain ends on the same date as the baseline finish.
- Hovering a bar shows the same summary as a Mesh card, plus hours, scheduled start and end, slack, and what the item is waiting on. Clicking the bar opens the Task or ToDo. Day, week, and month zoom and the Mesh color modes apply to the bars.

## 0.87.6 — 2026-10-15

### New Functionality
- A plan board shows a finish-date range. It uses hours completed in the last 28 days when that history exists, and weekly capacity otherwise. A long dependency chain can push the date later, and the chip says which of those inputs produced the range. Checking an item off or editing its hours updates the range.
- When a plan has no recent completions and no weekly capacity, someone who can edit the plan can set hours per week from the finish chip.

## 0.87.5 — 2026-10-15

### New Functionality
- Add Tasks and ToDos to a plan phase by number or title. A candidate already on another plan shows that plan's PL#### badge. Adding a parent asks whether to include its direct children. A short form in the phase creates a Draft task with optional hours.
- When Plans is enabled, the project rail lists that project's plans. A Task or ToDo shows every plan it belongs to, and a Mesh card offers Open in plan. Show dependencies names in-plan prerequisites on the board.

### Enhancements
- The plan search, draft-task, and new-plan fields use the same dark text-field theme as the rest of the app.

## 0.87.4 — 2026-10-15

### New Functionality
- Reorder a plan by dragging a row or with Alt+Up and Alt+Down. A parent moves with its children, a child stays inside that block, and a move that would put a dependent above its prerequisite is refused before it is saved. A stale revision snaps the board back and shows the server message.
- Fix order previews a dependency-safe sort, then applies it. When a new task dependency would break exactly one plan, Add and move creates the link and shifts that plan so the prerequisite stays first.

## 0.87.3 — 2026-10-15

### New Functionality
- Open a plan to work its phases on one board. The header shows hours done of the total, progress, and how many items still have no estimate. Each phase can be collapsed, and that choice stays in this browser.
- Check items off only in the ways the server allows. A Ready task offers Start or Start and complete, a blocked row names what it is waiting on, and reopening a finished task asks for a comment. A parent row shows its children's hours. Quarter-hour estimates can be edited on the row. The finish-date chip stays a placeholder until the baseline projection ships.

## 0.87.2 — 2026-10-15

### New Functionality
- Plans can be created and edited over the API: the plan itself, its phases, and which Tasks and ToDos sit in them. A single board response returns phases, items, in-plan dependencies, hour rollups, and the check-off actions the current person is allowed to take. Owners and Managers edit structure; Members can reorder and check items off; Viewers can read. A standalone plan stays with its owner.
- Reordering a plan, or adding a dependency that would put a dependent above its prerequisite, is refused and nothing moves. A stale revision is refused so two people cannot interleave drags. Checking off a Ready task records Start and then Complete. If open blockers remain, Complete is refused and the response names them.

## 0.87.1 — 2026-10-14

### Enhancements
- Adding a task dependency, or changing a Task or ToDo parent, is refused when a plan that already holds both items would put a dependent above its prerequisite or split a parent from its children. The error names each conflicting plan. Removing a dependency or clearing a parent still saves.

## 0.87.0 — 2026-10-14

### Enhancements
- Tasks, ToDos, and Projects can store a Start date. On a Task or ToDo it is a schedule hint and does not block In Progress when prerequisites are clear. A Project start date is the default anchor for a new plan. The form and the API both refuse a start date after the due date, and a due date before the start date, with the same message. The same calendar day is allowed. Task and ToDo lists can show, sort, and filter the column, and task import and export include it.
- Plans store a start date and a workday length (default 8 hours, quarter-hours from 0.25 through 24) for the later timeline. Plan editing waits on the plans API.

## 0.86.0 — 2026-10-14

### New Functionality
- A project can turn on Plans from Settings. The module stays off until enabled, and it does not appear in the project nav until the plan board ships. Plans, their phases, and Task or ToDo membership are stored so later work can order them and total hours. Display numbers are PL####.

## 0.85.10 — 2026-10-14

### Enhancements
- Mesh hover cards name each loaded dependency. Waits on and Unblocks show the display number, title, and state, with still-blocking prerequisites first and at most five entries before “+N more”. Clicking an entry focuses that record. A canceled prerequisite stays on the list as satisfied.

## 0.85.9 — 2026-10-14

### Enhancements
- Satisfied Mesh dependencies are thin, dashed, and muted, with a small arrowhead, so blocking lines stay easy to see. A Completed dependencies chip, off by default and remembered in this browser, hides those lines until it is turned on or a record at either end is hovered or focused. Administrators can set that color and line weight in Mesh appearance.

## 0.85.8 — 2026-10-14

### Fixes
- Opening a project's Mesh tab shows one canvas. The Mesh panel and the Ask panel no longer share a key, so earlier copies are not left on the page.

## 0.85.7 — 2026-10-14

### Enhancements
- Complete records on Mesh are a hollow outline with a check and a muted title in every color mode, so finished work stays distinct from open records and from hover dimming. Canceled records use the same outline with a struck-through title and no check. Priority, stale, and at-risk marks drop on both.

## 0.85.6 — 2026-10-14

### Enhancements
- Mesh dependency arrows run from the prerequisite to the dependent, so one prerequisite fans out with an arrowhead on each record it unblocks. The Focus legend and hover card say Unblocks and Waits on.

## 0.85.5 — 2026-10-14

### Fixes
- A canceled, pending, or deleted prerequisite no longer counts as blocking on Mesh. Dependency lines, the plan view, and the hover card’s Blocked by row use the same satisfied-state rule as the rest of the app.

## 0.85.4 — 2026-10-14

### Enhancements
- A mention typed in canvas text becomes a link from that canvas. Removing the mention, or deleting the text element, removes that link. A manual link on the same pair stays.

## 0.85.3 — 2026-10-14

### New Functionality
- Ask a project from the project menu or the Mesh toolbar. The answer is Markdown, a cited display number opens that record, and a PDF citation opens on that page. Thumbs on an answer are saved with that reply.

## 0.85.2 — 2026-10-14

### New Functionality
- A question about a project is answered only from that project's records. Each citation is a display number, plus a PDF page when the retrieved passage has one, and a number or page that was not in the retrieved set is omitted. When nothing supports an answer, the reply says so instead of guessing. A follow-up sends the recent turns with the new question.

## 0.85.1 — 2026-10-14

### Enhancements
- Golden sets for tagging, capture, duplicate pairs, and suggested links fail CI when a canned model reply no longer parses to the expected judgment. `npm run ai:golden` scores the same judgments against a configured provider and skips when no key is set.

## 0.85.0 — 2026-10-14

### New Functionality
- Opening a task, to-do, idea, or document can suggest related records, with a match percent and a short reason. Accept creates one manual References link. Dismiss hides that pair. The same suggestions appear as cards on the Mesh canvas.

## 0.84.0 — 2026-10-14

### New Functionality
- Home and the Digest page show the latest attention digest, with each item opening its record. Snooze an item until tomorrow or next week, or dismiss it for this period. A dot on Digest in the left rail stays until Home or the Digest page has shown that digest. Frequency, sections, and the AI summary are saved on the Digest page, and delivery stays at 07:00 in the browser's timezone.

## 0.83.0 — 2026-10-14

### New Functionality
- TaskMesh stores a daily or weekly attention digest for each person: overdue, at risk, stale, blocked, recent changes, tag suggestions, and possible duplicates. Work you own that is assigned to someone else is listed at the bottom with their name and status. An optional paragraph is marked as AI-written, and projects excluded from AI are named without their record titles being sent to the model.

## 0.82.1 — 2026-10-14

### New Functionality
- Quick capture opens from the command palette or with Ctrl/Cmd+Shift+K. Type one or more sentences, edit each proposed task, todo, or idea, and confirm to save it. A question stays on the card until you pick an answer or leave that field unset.

## 0.82.0 — 2026-10-14

### New Functionality
- While you type a task or todo title, TaskMesh warns when it looks like a task or todo you can already see. Open that record, link the two as duplicates, or ignore the pair so it is not raised again. Nothing is merged or deleted.

### Enhancements
- The duplicate warning uses the same corner radius as text fields.

## 0.81.0 — 2026-10-14

### Fixes
- A Ready task that still has an open prerequisite is stored as Blocked when a dependency is added, when the task stops being a parent, when a prerequisite is reopened, or when its editor opens. Ready tasks already in that state were corrected.

## 0.80.0 — 2026-10-14

### New Functionality
- When a record's text changes, TaskMesh suggests tags from tags you already use on similar records. If you opted into automatic changes, high-confidence tags are applied and one Undo removes that batch. Otherwise each tag is Accept or Dismiss. Excluded projects are never tagged.

### Enhancements
- Settings → Assistant lists Tagging beside Capture, including its model. New tag names stay off unless you allow them there.

## 0.79.1 — 2026-10-14

### New Functionality
- Send one sentence to Capture and get a task, todo, or idea proposal: title, due date, priority, project, list, tags, parent, and links. Dates use your time zone. Unclear names and dates come back as questions. Nothing is saved until a later confirm.

### Enhancements
- Settings → Assistant lists Capture beside the assistant, so you can pick its model or turn it off.

## 0.79.0 — 2026-10-14

### New Functionality
- Tasks and To Dos can store an Hours estimate in quarter-hour steps. A blank value means the item is not estimated, and 0 means it is trivial. The list column sorts and filters, and task import and export include the value.

## 0.78.0 — 2026-10-14

### Enhancements
- Parent tasks show how many descendant leaves are complete, with a progress bar beside the title. Their status follows those children and stays read-only until Manual status is turned on.

## 0.77.0 — 2026-10-14

### New Functionality
- Rotate the key that encrypts stored AI provider keys without replacing those keys. A dry run reports the rows and writes nothing. The update runs only when every stored key decrypts.
- A provider that rejects a stored key during Verify or a live assistant call shows a redacted message on Administration → AI for an instance key, or on Assistant settings for a user key. A later successful check clears it.

### Enhancements
- Backups state that the encryption key is not in the archive, and warn when that key is not set. Restoring provider keys requires the key that was current when the backup was taken. Administrator steps are in `docs/AI_CREDENTIALS.md`.

## 0.76.0 — 2026-10-14

### New Functionality
- Write AI instructions for the instance, a project, or yourself. A context packet for a record includes those instructions, the record, its parent and links, recent activity, and the top search hits. Each item is cited by its display number, secrets are redacted, and anything past the token budget is listed as dropped.

## 0.75.0 — 2026-10-14

### New Functionality
- Settings → Assistant is Your AI. Save a personal provider key, choose a model with a right-size recommendation, and turn the assistant off. Raise a permission tier or switch an action off. Cells an Administrator already denied stay locked, and the server rejects a save that would enable them. Usage, the Tier 1 opt-in, and the link to AI activity stay on the page.

## 0.74.0 — 2026-10-14

### New Functionality
- Administrators manage AI from Administration → AI: providers and keys, the permission matrix, Tier 1 and blast-radius limits, web access, the project default, and budgets. Floor resources stay locked off. Each change is recorded in the AI audit log, which can be filtered and exported as CSV. System Properties no longer holds those controls.

## 0.73.3 — 2026-10-13

### Enhancements
- Hovering Pending or Blocked on a task list State shows the tasks that row is waiting on, with number, title, and state. Blocked lists open Depends-on tasks. Pending lists unfinished child tasks. About ten lines stay visible and the rest scroll. The list does not open those tasks.

## 0.73.2 — 2026-10-13

### Enhancements
- An In Progress task can return to Ready when work stops or needs to be rewritten. The move requires a comment. If a prerequisite is still open, the task is stored as Blocked and becomes Ready when that blocker clears.

## 0.73.1 — 2026-10-13

### Enhancements
- Task list State is a dropdown limited to the next states the workflow already allows. Cancel and reopen still ask for a comment, and Complete still stops when an open Depends-on remains.
- Priority and State menus on task lists use the theme surface, and each option keeps its own color.

## 0.73.0 — 2026-10-13

### New Functionality
- TaskMesh indexes titles, notes, comments, and extracted PDF and EPUB text. Global search uses that index for prose and still finds a record by its number, such as T0208. When Ollama is enabled, the same text is embedded locally so later AI features can search by meaning. A project excluded from AI is not embedded and does not appear in that search. Administrators can rebuild the index from Administration → Jobs. PostgreSQL needs the pgvector extension (`postgresql-18-pgvector` on this host, or the pgvector Postgres 16 image in Compose).

## 0.72.0 — 2026-10-12

### New Functionality
- A project can be marked so AI for it uses local models only. Reads and proposals still follow full, read-only, or excluded. An Administrator can require local models for every project. A project can turn the mark on and cannot turn it off while that requirement is on. Chat on that project does not fall through to a cloud model if the local one errors or is rate-limited, and a chat opened somewhere else cannot read that project's records.

## 0.71.0 — 2026-10-12

### New Functionality
- Each AI provider call is recorded with token counts and whether it spent your key, the instance key, or a local model. Administrators can cap tokens per user per day, estimated instance-key spend per day, and how many tool calls or writes one reply may make. At 80% of a cap you see a warning. At the cap the assistant stops and says you have reached the AI usage budget. Assistant settings shows your usage today, and Administrators see the same day grouped by user, feature, and provider.

## 0.70.1 — 2026-10-12

### New Functionality
- Ordinary assistant edits stay on one-click cards with a before-and-after diff. A riskier turn opens a review list grouped by project. Each change has a checkbox, and nothing is saved until you approve the ones you checked. An update expires if that record changed after it was proposed. Mesh suggestions use the same Apply and Dismiss actions.

## 0.70.0 — 2026-10-12

### New Functionality
- When you opt in, a chat turn that only adds tags, links, comments, or task dependencies applies those changes immediately. A toast and the AI activity page can undo them for 7 days. If the record changed since, you can undo anyway or skip. A turn that also creates or edits a record still waits for confirmation.

## 0.69.2 — 2026-10-12

### Enhancements
- Record text, fetched pages, and file text sent to the assistant are wrapped as data. Instructions hidden in that text cannot close the wrapper or impersonate a system message. A later write or web fetch is marked in the audit log. A background feature cannot fetch the web after it has read a private record.

## 0.69.1 — 2026-10-12

### New Functionality
- A Draft task that still depends on unfinished tasks is stored as Blocked instead of Ready. It becomes Ready on its own when every prerequisite is finished. You can move it back to Draft or cancel it. The first time, a short explanation appears, and you can choose not to see it again on this device.

## 0.69.0 — 2026-10-12

### Enhancements
- Assistant prompts live in versioned files in the repo. Each reply records the prompt id and version in the audit log, including the web-fetch addendum when that is on, so a quality change can be traced to a prompt change. The log still does not store the prompt text.

## 0.68.0 — 2026-10-12

### New Functionality
- Uploading or replacing a PDF or EPUB extracts its text in the background, one span per page or chapter. The document shows when extraction is running, ready, empty, or failed. A scanned PDF with no text layer says OCR is not available. That text can be read by page or chapter for later search.

## 0.67.0 — 2026-10-12

### New Functionality
- The assistant picks a model that can use tools and a long context. Your pin wins, then the Administrator default, then the next ready provider. If the first provider is rate-limited, over quota, unreachable, or rejects the key, the next one answers before any tool runs. A local-only request never falls through to a cloud model. Each choice is written to the audit log without the prompt.

## 0.66.0 — 2026-10-12

### New Functionality
- Each user can store an encrypted provider key. Chat uses that key, the instance key, or neither, according to the key mode. A failed check keeps the last four characters and a short error, and never returns the key.
- The AI button stays visible and says why AI is off: no provider key, turned off by an Administrator, or this project is excluded. Read-only projects still open the assistant.

## 0.65.1 — 2026-10-12

### New Functionality
- Administrators can enable Ollama for local assistant chat and embeddings. Set a private or loopback http address, a chat model, and an embedding model. No API key is required. Link-local and cloud-metadata addresses stay blocked. An enabled OpenAI plugin still handles chat.

## 0.65.0 — 2026-10-12

### New Functionality
- Administrators store an encrypted instance key for each AI provider under System properties. The page shows only the last four characters. A stored key is used before the deprecated environment variable.
- The key mode is instance only, user only, or user preferred with instance fallback. On an instance with more than one active user, choosing a mode that spends the instance key requires typing “I understand and accept.” That acceptance is recorded without the key.

## 0.64.3 — 2026-10-12

### New Functionality
- Administrators can enable Azure OpenAI and set the resource endpoint, chat deployment, embeddings deployment, and API version. Chat and embeddings use those deployments. An enabled OpenAI plugin still handles chat. The server environment key is read when a request is sent and is not stored.

## 0.64.2 — 2026-10-12

### New Functionality
- Administrators can enable Google Gemini for assistant chat and embeddings, and set its public https address and default model. An enabled OpenAI plugin still handles chat. The server environment key is read when a request is sent and is not stored.

## 0.64.1 — 2026-10-12

### New Functionality
- Administrators can enable Anthropic for assistant chat and set its public https address and default model. Chat uses Anthropic when OpenAI is not the selected provider. The server environment key is read when a request is sent and is not stored.

## 0.64.0 — 2026-10-12

### New Functionality
- Rate each assistant reply with a thumbs-up or thumbs-down outline at the bottom right of the bubble, then add an optional note. Apply and Dismiss on a proposal are recorded as quality signals.
- Administrators see those signals under System properties, grouped by feature and model, including accept, dismiss, and undo rates.

## 0.63.1 — 2026-10-12

### Enhancements
- The assistant can read todos, todo lists, links, tags, comments, task dependencies, and the neighbourhood of a record. It can propose creating or updating a todo or list, and adding a link, tag, comment, or task dependency. Nothing is saved until you confirm. It still cannot delete, unlink, or find a path between two records.

## 0.63.0 — 2026-10-12

### New Functionality
- A project can be Full, Read-only, or Excluded from AI. The Administrator sets the instance ceiling, and a project owner or manager can only narrow it. Excluded projects are never sent to a model. Read-only projects can still be read, and the assistant cannot propose or apply changes there. The overview shows a badge when access is not full.

## 0.62.4 — 2026-10-12

### Enhancements
- The assistant assigns a permission tier on the server for every operation. A multi-step request is one change plan at the highest tier, and that plan rises to full review when it touches more than five records or two projects, reassigns a record, moves it to another project, or targets another person's record.
- The assistant cannot delete a record. A delete-shaped proposal is refused, and a person deletes the record in the app.

## 0.62.3 — 2026-10-12

### Enhancements
- The assistant sends a model a smaller record: title, a short excerpt, state, priority, dates, tag names, and display number. Secret-shaped text such as API keys, tokens, private keys, and connection strings is removed before it leaves the server.
- Assistant chat can fetch a public web page only after an Administrator turns that on under System properties. The switch is off by default, private addresses stay blocked, and each fetch is written to the audit log with the URL.

## 0.62.2 — 2026-10-12

### New Functionality
- Administrators open Jobs to see how many background jobs are waiting, running, or retrying, plus charts of completed and failed work. A job that uses up its retries appears in a dead-letter list. Retry runs it again, and Delete removes it after confirmation.
- Scheduled backups, API log pruning, and database stats sampling are durable jobs on the existing Postgres database. Work that has not finished is still queued after an API restart.

## 0.62.1 — 2026-10-12

### Enhancements
- Assistant chat goes through administrator-enabled provider plugins. OpenAI is the first plugin, and an OpenAI-compatible plugin can point at another public https Chat Completions host. The server environment key still unlocks OpenAI and is logged as deprecated. It is not copied into the database.
- System properties lists each loaded provider so an Administrator can enable it and set its base URL and default model. Private addresses and non-https URLs are rejected.

## 0.62.0 — 2026-10-12

### Enhancements
- The assistant checks a server-side policy before it reads records, proposes a change, or fetches a public page, and again when you confirm a proposal. Confirmed changes show an AI mark in History. The assistant cannot touch users, roles, groups, API keys, credentials, backups, ownership, or system settings.
- Each assistant tool call and confirmed proposal is written to an audit log with the user, action, allow or deny decision, and token counts. The log does not store the prompt or the record text.

## 0.61.1 — 2026-10-12

### Enhancements
- A Task follows one state path on every screen and API: Draft to Ready or Canceled, Ready to In Progress or Canceled, In Progress to On Hold or Complete, and On Hold back to In Progress or Complete. Canceling, and reopening a Complete or Canceled Task, requires a comment. Only a project Owner, Manager, or Administrator can reopen. Complete and Canceled Tasks stay read-only except for comments, a Task can have at most three tags, and new Tasks, including spreadsheet import, start as Draft.

## 0.61.0 — 2026-10-12

### Fixes
- A List View filter only keeps a field and operator pair that field's dropdown offers. Saving a Task Group with any other pair is rejected. Groups that had been saved as Tags is now use Tags contains for the same tag, so they still match the same tasks.

## 0.60.1 — 2026-10-12

### Enhancements
- Mesh collapses a band with more than 12 records of one type into one group node labeled with the count and drawn in a light box. Click the group to show those records, and click it again to collapse them. The focused record stays on the canvas, and depth, Hide done, and type filters still decide what is counted.

## 0.60.0 — 2026-10-11

### New Functionality
- Drag a node on Mesh to pin it. That position, and the canvas pan and zoom, come back after a reload, separately for Focus and Plan and for each record you open. Reset layout clears that saved view after you confirm. A new node is placed so it does not cover a pin.

## 0.59.1 — 2026-10-11

### New Functionality
- Mesh Plan view lays the same neighbourhood left to right along dependencies and parent/child links, with a row per project phase. A Ready task with an open dependency is marked Blocked, and a Ready task with none is marked Next. Switching back to Focus keeps the same record selected.

## 0.59.0 — 2026-10-11

### New Functionality
- A To Do and a To Do list have the same comment thread as a Task. The latest comment appears on the Mesh card, and it stays with the latest update when the same person posted both within two minutes.
- An Administrator can delete a comment on a Task, To Do, or To Do list after confirming. Anyone else who can write to the record can edit a comment, and cannot delete one.

## 0.58.12 — 2026-10-11

### New Functionality
- An Administrator sets Mesh colors and accessibility for every project from Administration → Mesh. The sample updates as you edit, a color below 3:1 contrast warns without blocking the save, and Reset returns the built-in look.

## 0.58.11 — 2026-10-11

### Enhancements
- A Task, To Do, Idea, or Document shows what links to it and what it links to. You can add a manual link from that record, or remove one. A link that came from a mention in the text stays until that mention is edited.

## 0.58.10 — 2026-10-11

### Enhancements
- An Administrator can raise or lower the global API ceiling and the search ceiling from System Properties. The new limits apply within a few seconds, without a restart.

## 0.58.9 — 2026-10-11

### Enhancements
- Where a Mesh line crosses another line or the containment bus, a background-colored understroke opens a small gap so one stroke reads as passing over the other.

## 0.58.8 — 2026-10-11

### Enhancements
- Rail and band links that would cross other columns share a corridor under the columns. Four or more lines into the same record draw as one trunk with a count, and hovering that record shows the separate lines.

### Fixes
- Opening a Mesh focus pins the highest record just below the top of the canvas. The focus record is no longer centered, so the project mesh does not open with a large empty band above it.

## 0.58.7 — 2026-10-11

### Enhancements
- Mesh lines that share a side leave at separate ports, ordered so they do not cross at the record. Lines through the same gutter each get their own lane, and a crowded gutter widens so the next columns shift right. The containment bus still meets those columns.

### Fixes
- Opening a Mesh hover card no longer rebuilds the records, so reference lines stay on the canvas instead of flashing off and back.

## 0.58.6 — 2026-10-11

### Enhancements
- Mesh lines leave the side that faces the other record. A same-column line is a rounded bracket in the gutter beside the labels, and a line to the left no longer wraps through the cascade. The hover card sits farther out so those nearby lines stay visible.

## 0.58.5 — 2026-10-11

### Enhancements
- Hovering or focusing a Mesh record fades unrelated lines, the containment bus, and records that are not that record or a line neighbour. The hover card stays fully visible, and the cascade does not move.

## 0.58.4 — 2026-10-11

### Fixes
- Hovering a Mesh record no longer leaves the browser title tooltip on top of the detail card. The tooltip appears only when the on-canvas title is truncated, and it is removed while that card is open. The card heading wraps the full title.

## 0.58.3 — 2026-10-11

### Enhancements
- A mention such as `#T0042` or the editor’s `[T0042]` label in a task, to-do, idea, or document is stored as a link. Removing the mention removes that link. A manual link to the same record stays.

## 0.58.2 — 2026-10-11

### Enhancements
- Mesh can limit how far the neighbourhood reaches (depth 1, 2, or 3), hide complete records, and hide a record type. The focused record stays on the canvas. The choice stays in this browser.

## 0.58.1 — 2026-10-11

### Enhancements
- A collapsed parent on a task list shows a light grey count of the descendant rows that collapse is hiding. The number sits next to the twistie on All Tasks, a project Tasks list, and a Task Group sub-list, and it disappears when the parent is open.

## 0.58.0 — 2026-10-11

### Enhancements
- Collapsed Task Groups, including Unassigned, stay closed after a refresh and on another browser. The choice is saved for you, not for everyone on the project.
- A collapsed parent task stays closed on the project Tasks list and on All Tasks. Opening it in either place opens it in both.

## 0.57.2 — 2026-10-11

### Enhancements
- Mesh can hide reference lines or depends-on lines from the toolbar. Turning References off also hides records that are on the canvas only because of those links. The choice stays in this browser.
- The AI suggestion slot is ready for a later suggestion list: a dashed outline, a dotted join, and a card to accept the link or dismiss it. The AI chip stays hidden until suggestions exist.

## 0.57.1 — 2026-10-11

### Enhancements
- Hover or focus a record on Mesh to see its state, due date, last change, comment, contents, blockers, and links. The card sits beside the record, follows the canvas, and a first touch opens it without changing focus.

## 0.57.0 — 2026-10-11

### Enhancements
- ToDos, projects, and documents share the task activity timeline. A state or progress change, a project status change, and a document edit are recorded, and a to-do list's last update is the newest change among its items.
- Mesh's stale clock follows that update. A comment or a title edit does not reset it. A record with no such update yet counts from the day it was created.

## 0.56.4 — 2026-10-11

### Enhancements
- Mesh draws each record as its own shape and can color the cascade by type, state, or priority. In Progress and Complete stay hollow so they stay distinct from Draft and Ready.
- Due dates show as overdue or at risk, quiet records show a stale clock, and high or urgent priority shows a badge. A depends-on line points at the prerequisite and stays red until that record is complete.
- Hovering a record thickens the lines that touch it in the theme accent and draws them above the other lines, without moving the cascade.

## 0.56.3 — 2026-10-11

### Enhancements
- Administrators can set how many signed-in sessions each user may keep. The default stays 1, so a new login still signs out every other session.
- A higher limit keeps the newest sessions and drops the oldest. Expired sessions do not count. Password changes, MFA clears, and an admin lock, deactivate, or password reset still end every session.

## 0.56.2 — 2026-10-11

### New Functionality
- A project can turn on Mesh and open a cascade of its records. The focused record sits over its contents, with its own links in a row beside it and links from inside on a rail.
- Click or press Enter to refocus. Back and the breadcrumb return, and a record from another project can be sent back to this project. Labels stay readable while you pan.

## 0.56.1 — 2026-10-11

### New Functionality
- Ask for the neighbourhood of one record and get the nearby records and how they connect, up to three steps away. Membership, parents, task dependencies, lists, boards, wiki links, source ideas, and directed links are included. Tags are included only when requested.
- Finished tasks and to-dos can be left out, and a neighbourhood stops at 300 records. A missing record is not found. A record outside your access is refused.

## 0.56.0 — 2026-10-11

### Fixes
- Production dependencies are pinned past the current high and critical npm advisories (`shell-quote`, and the nested `sass` copy pulled in by canvases) so the security scan can pass.

### New Functionality
- Any two records can be linked with a directed relation: relates to, references, supports, or part of. The links API lists what a record points to and what points at it, with display numbers and a path to open each record.
- Deleting a record removes its links, including when a project delete cascades to its contents. Soft-deleted tasks and to-dos stay stored and drop out of the link list until they are restored.

## 0.55.1 — 2026-09-28

### Enhancements
- Drag a ToDo onto the middle of another ToDo in the same list to make it a child. Drag it onto the Top level strip to clear the parent. Its children move with it.
- The top and bottom edges of a row still reorder siblings and do not change the parent. Dropping on yourself, a descendant, or a Task does nothing.
- The parent dropdown and Sub button are removed from the list row and the ToDo editor. New items stay top-level.

## 0.55.0 — 2026-09-28

### Fixes
- Returning to a project To Do list keeps the rows on screen. The tab count and the list share one record, so a refresh when the window regains focus cannot replace the list with a number.

### Enhancements
- To Dos can nest. A child indents under its parent when both are on the same list. Add a sub-item from the row, or set the parent on the row and in the editor.
- A parent shows how many direct sub-items are complete and a calculated percent. Marking it complete while a sub-item is still open stores Pending. When every direct sub-item is finished, a Pending parent becomes Complete at 100%.

## 0.54.0 — 2026-09-28

### Enhancements
- To Do list rows show a progress bar from a percent stored on the ToDo. The bar is red through 25%, orange through 50%, yellow through 75%, and green from 76% up.
- Setting progress to 100% marks the ToDo Complete and checks it on every list it belongs to. Completing the ToDo or checking the row sets progress to 100%. Unchecking a completed ToDo, or moving progress below 100%, reopens it.

## 0.53.0 — 2026-09-28

### Enhancements
- The Ideas list uses the same column header as To Do lists. Drag reorder is the default. Clicking a column sorts the list and turns drag off until you return to the saved order.
- Filter Ideas by title, tags, created date, updated date, or assignee. Drag stays off while a filter is hiding rows.
- New ideas appear at the top of the manual order. Existing ideas stay newest-created first until you drag them.

## 0.52.0 — 2026-09-28

### Enhancements
- To Do lists use a shared column header. Drag reorder stays the default manual order. Clicking a column sorts that list and turns drag off until you return to the saved order.
- Right-click the To Do list header to show, hide, or reorder columns. The layout is saved for your account and applies to every To Do list.

## 0.51.0 — 2026-09-28

### Enhancements
- Administrators rename a user by double-clicking the display name in Administration → Users. Enter or leaving the field saves; Escape cancels.
- Display names are unique regardless of letter case, including when creating a user or saving Profile. A name already in use is rejected.

## 0.50.1 — 2026-09-28

### Enhancements
- Finish-up on the development host merges to `main` and no longer deploys a local production process. The public Production site is upgraded by an Administrator from a GitHub Release.
- Task bookkeeping and schema-doc sync on this host use the DEV API on port 3001.

## Format

Each finished version is a heading plus only the non-empty sections below. Bullets are 1–3 concise sentences describing **outcome** (not the work process). Call out schema or public API breaks under **Breaking Changes**.

```markdown
## x.y.z — YYYY-MM-DD

### Fixes
- …

### Enhancements
- …

### New Functionality
- …

### Breaking Changes
- …

### Deprecated Functionality
- …
```

Omit any section with nothing to report. Do not keep an `Unreleased` section.
