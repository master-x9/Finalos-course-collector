# FinalsOS Course Collector

A local-first Chrome extension that asks before saving course video transcripts and exports reading lessons as clean, structured `.txt` study notes.

> **Status:** Personal-use project. Tested with static syntax/manifest checks; live course-page behavior can vary as the learning platform's markup changes.

## Features

- **Transcript prompts:** Detects SRT transcript requests from the configured media host and asks before saving. The filename is editable.
- **Reading prompts:** Detects supported reading lesson containers and asks before exporting.
- **Readable text exports:** Formats headings, paragraphs, lists, tables, alerts, inline code, and code examples rendered in Ace editor blocks.
- **MCQs in a separate section:** Separates recognized question wrappers from the reading text and places their detected options in a clearly labeled section. It does not guess answer keys.
- **Filename control:** Exports transcripts as `.srt` and reading notes as `.txt` using the edited filename.
- **One-click enable/disable:** The toolbar popup contains an ON/OFF switch for automatic save prompts.
- **No automatic file saving:** A user confirmation is required for each export.
- **Local-first behavior:** No telemetry, analytics, external AI calls, or uploads of captured lesson content are implemented.

## Screenshots

### Transcript save prompt

![Transcript save prompt](screenshots/transcript-save-prompt.png)

### Extension settings

![Extension settings popup](screenshots/extension-settings-popup.png?v=2)
## Install in Chrome

1. Download this repository as a ZIP and extract it, or clone it with Git.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Reload any already-open course tabs.
7. Click the extension toolbar icon to enable or disable **Automatic save prompts**.

To update an existing local installation, replace the old source files with the new version and click **Reload** on `chrome://extensions`.

## How to use

### Video transcript

1. Leave **Automatic save prompts** switched ON.
2. Open a supported video lesson and play/load it so the lesson requests its transcript.
3. When an SRT request is detected, the extension opens a save prompt.
4. Edit the filename, then choose **Save transcript** or **Not now**.

### Reading material

1. Open a supported reading lesson.
2. When the reading content is detected, choose whether to save it.
3. Edit the filename and save the `.txt` document.
4. Review the `READING MATERIAL` section and the separate `MCQ PRACTICE QUESTIONS` section.

Some course code examples are loaded or expanded dynamically. The exporter attempts to expand supported code-block controls before capture. If the platform doesn't expose the full code in the rendered DOM, some material may still require manual verification.

## Supported page layouts

The content script currently looks for these reading containers:

- `.tutorial-content-container`
- `[data-testid="text-learning-card"]` with nested Markdown content

It excludes feedback wrappers whose class contains `SubmitFeedbackButtonWrapper` and recognizes question blocks whose class contains `TutorialContentMcqQuestionWrapper`.

The transcript observer is restricted to SRT files under:

`https://nkb-backend-ccbp-media-static.s3.amazonaws.com/media/transcripts/`

The course content script is restricted to pages matching `https://learning.ccbp.in/*`. Selectors and request patterns may need updating if the site changes.

## Project structure

```text
finalsos-course-collector/
├── .github/
│   └── workflows/
│       └── check-extension.yml
├── screenshots/
│   ├── extension-settings-popup.png
│   └── transcript-save-prompt.png
├── scripts/
│   └── check-extension.mjs
├── background.js
├── content.js
├── manifest.json
├── popup.html
├── popup.js
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
└── README.md