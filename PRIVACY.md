# Privacy Policy — Udemy AWS Prep Exam Copilot

_Last updated: 2025-12-24

## What this extension does
- Runs on Udemy practice exam pages to highlight questions/answers, show “why” explanations, summarize content, and optionally read text aloud.
- Uses your provided API keys (OpenAI-compatible LLM, optionally Google Cloud Text-to-Speech) to make requests directly to those providers from your browser.

## Data we collect
- **Local storage only:** Settings (LLM API key, model name, optional Google TTS key, display toggles) and weak-topic stats are stored in `chrome.storage` on your device.
- **Website content:** The extension reads the current Udemy practice exam page in your browser to highlight/summarize/show explanations. This processing happens locally.
- No account creation, no analytics, no tracking pixels.

## Data sharing
- We do not sell or share your data.
- No additional servers are used by this extension; requests go directly from your browser to Udemy (page content) and to the API providers you configure (LLM/TTS).

## API keys and requests
- Your API keys are stored in your browser and are used only to call the services you configure (OpenAI-compatible LLM, optional Google Cloud Text-to-Speech).
- You control what content is sent to these providers; avoid sending sensitive or personal data.

## Permissions
- `tabs` and host permission for `https://www.udemy.com/*` are used to detect and operate on Udemy practice exam pages.
- `storage` is used to persist your settings and local weak-topic stats.

## Your choices
- You can clear keys and settings anytime via the popup.
- Removing the extension deletes stored data.

## Contact
- For questions or issues, open an issue on GitHub: https://github.com/MarvinAmine/UDEMY_AWS_PREP_EXAM_COPILOT

## Disclaimer
This is an independent tool and is not affiliated with or endorsed by Udemy or AWS.
