# Helper for Pixiv

A Chrome extension that saves the pixiv artwork you are viewing in one click: every original-size image, a `metadata.json`, and ugoira as MP4 (or WebM / ZIP only), into one folder under Downloads.

**Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/helper-for-pixiv/acodafjaeeanbgobjgpjknnehibaednb)

- Privacy: [PRIVACY.md](PRIVACY.md). Nothing is collected; the extension talks only to pixiv.net and its image host.
- Issues and questions: https://github.com/kyoicn/pixivhelper/issues

## Development

Requires Node 22+.

```
npm ci
npm run check      # typecheck, lint, unit tests, dev build into dist/
npm run test:e2e   # Playwright suite against a fake pixiv
npm run zip        # production build packed as helper-for-pixiv-<version>.zip
```

Load `dist/` (or the unzipped release) via `chrome://extensions` → Developer mode → Load unpacked.

Helper for Pixiv is an independent project and is not affiliated with pixiv Inc.
