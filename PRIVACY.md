# Privacy policy — Helper for Pixiv

Last updated: 2026-10-24

Helper for Pixiv is a Chrome extension that saves the pixiv artwork you are viewing into your Downloads folder. This page describes what it does with data.

## What the extension collects

Nothing. The extension has no server, no account, no analytics and no crash reporting. It does not collect, store or transmit personal information, browsing history, or the content you download.

## What the extension stores on your device

Three settings: the download folder pattern, the ugoira output format and whether to save `metadata.json`. They are kept in Chrome's extension storage. If you have Chrome Sync turned on, Chrome may sync these settings to your other Chrome profiles through your Google account; the extension itself never sends them anywhere.

While a download runs, the extension keeps a record of the job (the artwork ID, file names and progress) in Chrome's session storage so that the download survives a service-worker restart. This record is deleted when Chrome quits.

## What the extension connects to

Only `www.pixiv.net` and pixiv's image host `i.pximg.net`, to read the artwork's page list and fetch the original-size images, in the same way your browser does when you view the artwork. The extension adds a `Referer: https://www.pixiv.net/` header to its own image requests, because pixiv's image host refuses requests without it. It does not modify any other request.

Downloaded files are written by Chrome into your Downloads folder and never leave your computer.

## Login and age-restricted content

The extension does not handle your pixiv credentials. Works that pixiv shows only to logged-in users (for example R-18) can be downloaded only when you are logged in to pixiv yourself, in your own browser session.

## Permissions

| Permission                                       | Why                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `downloads`, `downloads.ui`                      | Save the files; hide Chrome's per-file download animation during a multi-file save, then restore it. |
| `storage`                                        | The three settings and the running-job record above.                                                 |
| `offscreen`                                      | Encode ugoira videos in the browser (WebCodecs is not available in service workers).                 |
| `declarativeNetRequestWithHostAccess`            | The `Referer` header on the extension's own image requests.                                          |
| Host access to `www.pixiv.net` and `i.pximg.net` | Show the Download button on artwork pages and fetch the images.                                      |

## Changes and contact

If this policy changes, the new version is published at this URL with a new date. Questions and reports: https://github.com/kyoicn/pixivhelper/issues
