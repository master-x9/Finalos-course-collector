# Contributing

Thanks for considering an improvement to FinalsOS Course Collector.

## Before opening a pull request

1. Keep changes focused and explain the user-visible behavior they improve.
2. Run `node scripts/check-extension.mjs`.
3. Test the extension manually in Chrome when possible, including both ON and OFF states.
4. Verify transcript and reading filenames, `.txt` formatting, code indentation, and MCQ separation.
5. Update `README.md` and `CHANGELOG.md` if behavior or setup changes.

## Privacy requirements

- Never commit exported transcripts, personal study notes, session cookies, authorization headers, signed transcript URLs, or other private course data.
- Do not add analytics, telemetry, or remote uploads of lesson content without an explicit, documented design change.
- Use sanitized examples in bug reports and screenshots.

## Reporting a bug

Include the browser version, the expected and actual behavior, and a sanitized description of the page type. Do not attach signed URLs or credentials.
