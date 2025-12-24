# Udemy AWS Prep Exam Copilot

Chrome extension that helps you read, summarize, and chat through Udemy AWS certification practice exams. It highlights answers, explains the "why," and can read questions aloud.

## Features
- Guided setup wizard for API keys and usage
- LLM insights (chat, summaries, explanations)
- Optional Google Cloud Text-to-Speech for audio playback
- Keyword highlighting and “Why?” bubbles
- Weak-topic tracking stored locally
- Page detector with quick link to AWS practice exams

## Install (unpacked)
1. Download/clone this repo.
2. In Chrome, go to `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.

## Configure
Open the extension popup and:
1. Add your OpenAI-compatible LLM API key (required) and model name.
2. (Optional) Add a Google Cloud Text-to-Speech API key for audio.
3. Use the guided setup to highlight the correct fields and steps.

## Use
1. Open a Udemy AWS practice exam page (URLs like `.../learn/quiz/.../result` or `.../test#...`).
2. Reopen the popup if you navigate—status indicator shows if you’re on a valid practice exam.
3. Toggle highlighting/“Why?” bubbles as needed; weak topics appear after analyses.

## Development
- Manifest v3; main popup HTML/CSS/JS live in `popup.html`, `css/styles.css`, `src/popup.js`.
- Content scripts are listed in `manifest.json`; no build step is required for the popup.
- Keep API keys out of source control.

## Contributing
Issues and PRs are welcome at https://github.com/MarvinAmine/UDEMY_AWS_PREP_EXAM_COPILOT. See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## License
MIT License. See `LICENSE`.
