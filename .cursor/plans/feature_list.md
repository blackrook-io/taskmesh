# TaskMesh

A responsive webapp for collecting thoughts, notes, and tasks into simple collections and more complex projects.

## Record types

### Tasks

- The **Notes** field should support the same Markdown capabilities as Markdown Documents (below).
- Clicking into the Notes field on a Task should present the same toolbar used on a Markdown Document.
- Clicking out of any Task field will auto-save the Task to the database.
  - Allow **Ctrl+Z** undo up to **10 steps**, or back to the state when the Task was opened for editing.

### To Do lists

- Can contain **Ideas** or **Tasks**.

### Projects

- User can choose which Elements belong in a Project, on a per-project basis.
  - One Project might have a To Do list; another might not.
  - If an Element type is not present, should it still appear in the Project view (e.g. as a “Create” opportunity)?
- Different views of different records, all linked from the project view page.

## Tags

- All record types should support attaching and removing Tags so searches can find all records with a Tag.
- Clicking a **tag area** on a record allows typing a Tag name.
  - After **three letters**, show subtle popup suggestions of existing Tags.
  - A new Tag name creates a new Tag.
- Mousing over a Tag fades in a small **×** in the top-right of the Tag button to remove it from that record.
- Tags can have assigned colors from a standard **16-color palette** (customizable).
- **Right-clicking** a Tag opens a small color selection window next to the Tag.

## Markdown documents

- Rich text / Markdown functionality:
  - URL linking
  - Bold, Italic, Underline
  - Standard headings
  - Bullet lists and numbered lists
  - Paragraph alignment
  - Simple checklists
  - Simple Markdown tables
- Support pasting an image from the system clipboard.
- Implement **UpNote**-style Markdown functionality as much as possible.

## Canvas

- Basic flowcharting, diagramming, mood boards, and graphic collections (Lucid Chart–style).
- Automate canvas organization:
  - Smart line routing
  - Automatic shape spacing
  - Drop zones that adjust lines as shapes are added
- Initial diagramming types:
  - System architecture diagrams for software design
  - Entity relationship diagrams (ERDs), optionally via text markup languages
- Canvas background should be a **darker grey** than the standard UI background.
- Shapes should share the same popup colorization behavior as Tags.

## Task Planning Board (Kanban)

- Kanban-style board for Tasks and To Dos.
  - Different element/record types can be intermingled.
- Each Task Planning Board belongs to a **Project**.
- Each Project can have **multiple** Task Planning Boards.
- Drag and drop between columns.
- Columns and lanes are editable.
- Depicted Tasks can be opened and edited quickly from the board.

## Wiki

- Collection and structure for Markdown files and Canvas records.
- Automatic drag-and-drop **Table of Contents** on the left.
  - Dragging a TOC entry moves it up, down, or into another element (as a sub-element).

## Shared element model

Each Element has:

- **Mode** — modal or full-screen (e.g. a Task as a Card, popup Modal, or full-screen record in different areas of TaskMesh).
- **Attributes** at the database level for the record type (table): unique id, name, description, body, due date, etc.
- **Relationships** — e.g. Tasks associated to a Project; Tags associated to various other records.
