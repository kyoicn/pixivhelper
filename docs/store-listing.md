# Chrome Web Store listing

Paste-ready copy for the developer dashboard (release-checklist §4 and §5). The name and the short description come from each locale's `messages.json` (`ext_name`, `ext_description`), so the store reads them from the zip; they are repeated here only so the listing can be reviewed in one place. The full description is entered per language under Store listing → the language picker.

Native-speaker review of ja, zh_CN and zh_TW is a release gate (PRD index "Internationalization"); record who reviewed each in the release note.

## Common fields

| Field | Value |
|---|---|
| Name | Helper for Pixiv (all four locales, R-002) |
| Category | Productivity → Tools |
| Language | English (default), 日本語, 中文 (简体), 中文 (繁體) |
| Support URL | https://github.com/kyoicn/pixivhelper/issues (R-001) |
| Homepage URL | https://github.com/kyoicn/pixivhelper |
| Store icon | `icons/icon-128.png` from the zip |
| Small promo tile | `promo-tile-440x280.png` |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` |
| Screenshots | 1280×800, per locale: idle button, progress, Saved, Settings |
| Single purpose | Save the pixiv artwork you are viewing. |
| Remote code | No |
| Data usage | No user data collected. Tick the three certifications. |

## en

**Short description** (119 / 132 characters)

Save a whole pixiv artwork in one click: every original image, metadata.json, and ugoira as MP4 or WebM, in one folder.

**Full description**

Helper for Pixiv adds one Download button to every pixiv artwork page, right next to Like. One click saves the whole work into your Downloads folder.

WHAT IT SAVES
• Every page of an illustration or manga at original size, named <id>_p0.jpg, <id>_p1.jpg, …
• A metadata.json with the title, description, tags, dates and artist.
• Ugoira (animations) as an MP4 video, encoded in your browser. WebM and "ZIP only" are available in Settings. The original frame zip and its frames.json are always saved too.

HOW IT BEHAVES
• The button shows the page count before you click (Download · 12P), the progress while it runs (7 / 12), and Saved · 12P when every file is on disk. Hover to cancel.
• Downloads keep running if you close the tab. The toolbar icon shows how many files are still remaining.
• If a file fails, the button turns into Retry and fetches only the missing pages into the same folder.
• Downloading the same work again never overwrites: Chrome adds (1), (2), … to the file names.
• The folder name is yours to choose, with tokens for the artist, work ID, title and user ID. The default is pixiv/<artist>-<id>.

PRIVACY
• Only talks to pixiv.net and its image host. Nothing you download leaves your browser.
• No account, no sign-in to the extension, no tracking, no analytics.
• Works for which pixiv requires a login (for example R-18) are downloadable only after you log in to pixiv yourself; the button then reads "Log in to download".

Available in English, 日本語, 简体中文 and 繁體中文. Open source: https://github.com/kyoicn/pixivhelper

Helper for Pixiv is an independent project and is not affiliated with or endorsed by pixiv Inc. Please respect the artists' rights and pixiv's terms of use when saving artwork.

## ja

**Short description** (71 / 132 文字)

pixivの作品をワンクリックで保存。すべての原寸画像、metadata.json、うごイラのMP4/WebMを1つのフォルダーにまとめます。

**Full description**

Helper for Pixiv は、pixiv の作品ページの「いいね」の隣に「ダウンロード」ボタンを1つ追加します。ワンクリックで作品全体を「ダウンロード」フォルダーに保存します。

保存されるもの
• イラスト・マンガの全ページを原寸サイズで保存（<id>_p0.jpg、<id>_p1.jpg、…）
• タイトル・キャプション・タグ・日時・作者を記録した metadata.json
• うごイラはブラウザー内でエンコードした MP4 動画として保存。設定で WebM や「ZIP のみ」も選べます。元のフレーム zip と frames.json は常に一緒に保存されます。

動作
• クリック前はページ数（ダウンロード · 12P）、実行中は進行状況（7 / 12）、完了後は「保存済み · 12P」を表示。ホバーでキャンセルできます。
• タブを閉じてもダウンロードは続行します。ツールバーのアイコンに残りファイル数が表示されます。
• ファイルの取得に失敗すると「再試行」ボタンになり、足りないページだけを同じフォルダーに再取得します。
• 同じ作品を再度ダウンロードしても上書きはしません。Chrome がファイル名に (1)、(2)、… を付けます。
• フォルダー名は自由に設定できます。作者名・作品 ID・タイトル・ユーザー ID のトークンが使えます。初期設定は pixiv/<作者>-<id> です。

プライバシー
• 通信先は pixiv.net とその画像サーバーのみ。ダウンロードしたものがブラウザーの外に送られることはありません。
• アカウント不要、拡張機能へのログイン不要、トラッキングや解析もありません。
• pixiv がログインを必要とする作品（R-18 など）は、ご自身で pixiv にログインした後にダウンロードできます。その場合、ボタンは「ログインしてダウンロード」と表示されます。

対応言語：English、日本語、简体中文、繁體中文。オープンソース：https://github.com/kyoicn/pixivhelper

Helper for Pixiv は独立したプロジェクトであり、ピクシブ株式会社とは提携・承認関係にありません。作品を保存する際は、作者の権利と pixiv の利用規約を尊重してください。

## zh_CN

**Short description**（65 / 132 字符）

一键保存整个 pixiv 作品：全部原图、metadata.json，以及 MP4 或 WebM 格式的动图，统一存入一个文件夹。

**Full description**

Helper for Pixiv 在每个 pixiv 作品页面的"赞"旁边添加一个"下载"按钮。点击一次，即可把整个作品保存到你的"下载"文件夹。

保存内容
• 插画或漫画的每一页原图，命名为 <id>_p0.jpg、<id>_p1.jpg……
• 一个 metadata.json，记录标题、简介、标签、日期和作者。
• 动图（ugoira）在浏览器内编码为 MP4 视频。设置中可改为 WebM 或"仅 ZIP"。原始帧 zip 和 frames.json 始终一并保存。

使用体验
• 点击前按钮显示页数（下载 · 12P），下载中显示进度（7 / 12），全部落盘后显示"已保存 · 12P"。悬停即可取消。
• 关闭标签页后下载仍会继续。工具栏图标显示剩余文件数。
• 某个文件失败时，按钮变为"重试"，只重新获取缺失的页面并存入同一文件夹。
• 重复下载同一作品不会覆盖：Chrome 会在文件名后加上 (1)、(2)……
• 文件夹名称可自定义，支持作者、作品 ID、标题和用户 ID 等占位符。默认是 pixiv/<作者>-<id>。

隐私
• 只与 pixiv.net 及其图片服务器通信。你下载的内容不会离开浏览器。
• 无需账号，无需登录扩展，没有跟踪，没有统计分析。
• 需要登录 pixiv 才能查看的作品（例如 R-18），需要你自行登录 pixiv 后才能下载，此时按钮显示"登录后下载"。

支持语言：English、日本語、简体中文、繁體中文。开源地址：https://github.com/kyoicn/pixivhelper

Helper for Pixiv 是独立项目，与 pixiv 株式会社无隶属或背书关系。保存作品时请尊重作者权利并遵守 pixiv 的使用条款。

## zh_TW

**Short description**（65 / 132 字元）

一鍵儲存整個 pixiv 作品：所有原圖、metadata.json，以及 MP4 或 WebM 格式的動圖，統一存入一個資料夾。

**Full description**

Helper for Pixiv 會在每個 pixiv 作品頁面的「讚」旁邊加上一個「下載」按鈕。點一下，就能把整個作品存到你的「下載」資料夾。

儲存內容
• 插畫或漫畫的每一頁原圖，命名為 <id>_p0.jpg、<id>_p1.jpg……
• 一個 metadata.json，記錄標題、說明、標籤、日期與作者。
• 動圖（ugoira）會在瀏覽器內編碼成 MP4 影片。設定中可改為 WebM 或「僅 ZIP」。原始影格 zip 與 frames.json 一律一併儲存。

使用體驗
• 點擊前按鈕顯示頁數（下載 · 12P），下載中顯示進度（7 / 12），全部存好後顯示「已儲存 · 12P」。滑鼠移上去即可取消。
• 關閉分頁後下載仍會繼續。工具列圖示會顯示剩餘檔案數。
• 某個檔案失敗時，按鈕會變成「重試」，只重新抓取缺少的頁面並存入同一個資料夾。
• 重複下載同一作品不會覆蓋：Chrome 會在檔名後加上 (1)、(2)……
• 資料夾名稱可自訂，支援作者、作品 ID、標題與使用者 ID 等代碼。預設為 pixiv/<作者>-<id>。

隱私
• 只與 pixiv.net 及其圖片伺服器通訊。你下載的內容不會離開瀏覽器。
• 不需要帳號，不需要登入擴充功能，沒有追蹤，沒有分析統計。
• 需要登入 pixiv 才能檢視的作品（例如 R-18），必須由你自行登入 pixiv 後才能下載，此時按鈕會顯示「登入後下載」。

支援語言：English、日本語、简体中文、繁體中文。開放原始碼：https://github.com/kyoicn/pixivhelper

Helper for Pixiv 是獨立專案，與 pixiv 株式會社沒有隸屬或背書關係。儲存作品時請尊重作者權利並遵守 pixiv 的使用條款。

## Privacy practices tab

| Field | Text |
|---|---|
| Single purpose | Save the pixiv artwork you are viewing. |
| `downloads` | Saves the artwork's files into the user's Downloads folder (the single purpose). |
| `storage` | Remembers the three settings. Keeps running downloads alive across service-worker restarts. Nothing persists after Chrome quits. |
| `offscreen` | WebCodecs and `URL.createObjectURL` are not available in service workers. The offscreen document encodes ugoira videos and hands downloaded bytes to Chrome's downloader. |
| `declarativeNetRequestWithHostAccess` | One session rule sets `Referer: https://www.pixiv.net/`. pixiv's image host returns 403 without this Referer. The rule matches only the extension's own requests to `i.pximg.net`, never browsing traffic. |
| `downloads.ui` | Hides Chrome's per-file download animation while a multi-page artwork saves, then restores it. |
| Host permissions | `https://www.pixiv.net/*`: Shows the button on artwork pages and reads the artwork's page list. `https://i.pximg.net/*`: Downloads the original-size images. |
| Remote code | No. All code is bundled; MV3's default CSP applies. |
| Data usage | No data category ticked. Certify: no sale of user data, no use unrelated to the single purpose, no use for creditworthiness or lending. |
