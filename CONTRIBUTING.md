# Contributing

Thanks for your interest in improving the Udemy AWS Prep Exam Copilot!

## Ways to contribute
- Report bugs or usability issues (include steps, current/expected behavior, and URL patterns).
- Suggest UX improvements for the popup/wizard.
- Submit pull requests for fixes or small enhancements.

## Pull requests
- Fork and branch from `main`.
- Keep changes scoped and documented in the PR description.
- Avoid committing API keys or secrets.
- Test the popup manually by loading the unpacked extension and exercising the changed flows.

## Issues
- Provide a clear title and summary.
- Include Chrome version and whether you’re on a practice exam page (`/learn/quiz/.../result` or `/test#...`).
- Attach screenshots/gifs when UI-related.

## Coding style
- Plain JS/HTML/CSS (manifest v3). No build step.
- Keep comments concise and only where the intent isn’t obvious.
- Prefer small, focused diffs.

## Release notes
Maintainers will handle version bumps in `manifest.json` when publishing.
