# Architecture
* The application should be deployable to an Ubuntu Linux server.
* README.md should include Ubuntu commands to install all needed packages to support the app.
* Prefer Node.js and TypeScript for language.
* Frameworks or supporting technology selected should be actively developed, mature, and have a healthy ecosystem of support and contribution.
* Datastore should be able to be backed up regularly.



# UI
* Aim for responsive, interactive UI that is able to be used on mobile.
* The UI should be themed dark grey and light green.
* The UI should be easy and intuitive to use.
* Should include a WYSIWYG editor that handles Markdown with functionality to easily switch between Preview and Edit modes.


# App functionality
The application itself should be able to allow a user to create and manage records for the following types of "things":
* Projects, from idea to in-progress, including a robust task list functionality that allows for notes, prioritization (drag and drop in lists), color-coding, phases and basic standard project management activities.  No 'assignment' is needed, as this app is single-user at this time.
* Simple Idea records that can later be converted to a Project if needed.  These should allow for notes, checklists, URLs and image additions to the Markdown record.


# Security
* This is a single-user, private-network application. Future plans may expand to public app, multi-user platform.
* No auth needed at this time.
* Deletions should require active user confirmation.
