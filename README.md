<p align="center">
  <img src="assets/icons/app.png" width="96" alt="0x Browser logo" />
</p>

<h1 align="center">0x Browser</h1>

<p align="center">
  A minimal, performance-focused desktop browser for Windows.<br />
  Dark, clean and fast — no telemetry, no clutter.
</p>

<p align="center">
  <a href="https://github.com/Kuba0734/0x-Browser/releases/latest"><b>Download for Windows</b></a>
</p>

---

## Features

- **Tabs & navigation** – tabs, back/forward/reload, address bar with search and inline history completion
- **Tabs that stay** – open tabs and windows are restored after a restart, inactive ones load on demand
- **Drag tabs** – reorder tabs by dragging, drag a tab out of the tab strip to open it in a new window
- **Context menu** – right-click for links, images, selected text, input fields and Inspect
- **Home tab** – search, quick access to every browser page and your most visited sites
- **Bookmarks** – star any page, folders, a bookmarks bar that appears once you have bookmarks
- **Downloads** – live progress, pause, resume, cancel, open file or folder
- **Settings** – every color, radius, spacing, font size and animation speed is adjustable and applies instantly
- **Performance page** – memory, CPU and load time per tab, put tabs to sleep manually or automatically after inactivity
- **Extensions** – install from the Chrome Web Store, Edge Add-ons or Opera add-ons (an "Add to 0x" button appears on their pages) or load your own from a folder
- **Import** – bookmarks and history from Chrome, Edge, Brave, Opera, Opera GX, Vivaldi and Firefox (cookies from Firefox)
- **Dark mode for websites** – makes light websites like Google dark
- **Automatic updates** – new versions are downloaded in the background and installed on restart

## Install

1. Download `0x-Browser-Setup-x.y.z.exe` from the [latest release](https://github.com/Kuba0734/0x-Browser/releases/latest).
2. Run it. The browser installs for your user only and starts right away.

> The installer is not code-signed yet, so Windows SmartScreen may show "Windows protected your PC".
> Click **More info → Run anyway**.

Updates are checked on every start. When a new version is ready, a green update button appears in the toolbar.

## Browser pages

| Address            | Page                                  |
| ------------------ | ------------------------------------- |
| `0x://home`        | Home tab                              |
| `0x://bookmarks`   | Manage bookmarks and folders          |
| `0x://downloads`   | Download list                         |
| `0x://settings`    | Settings, import, appearance, updates |
| `0x://extensions`  | Install and manage extensions         |
| `0x://performance` | Memory, CPU and load time per tab     |

## Keyboard shortcuts

| Shortcut                      | Action                    |
| ----------------------------- | ------------------------- |
| `Ctrl+T`                      | New tab                   |
| `Ctrl+W`                      | Close tab                 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab       |
| `Ctrl+1` … `Ctrl+8`, `Ctrl+9` | Go to tab, go to last tab |
| `Ctrl+L`, `Alt+D`, `F6`       | Focus address bar         |
| `Ctrl+R`, `F5`                | Reload                    |
| `Ctrl+Shift+R`, `Ctrl+F5`     | Reload without cache      |
| `Alt+Left` / `Alt+Right`      | Back / forward            |
| `F12`, `Ctrl+Shift+I`         | Developer tools           |

## Privacy

- No telemetry, no accounts, no analytics.
- The only request the browser makes on its own is the update check against this repository's GitHub releases.
- Web content runs sandboxed and has no access to the browser's internal pages or APIs.
- All data (history, bookmarks, settings) stays on your PC in `%APPDATA%\0x Browser`.

## Known limitations

- Windows only.
- Not every Chrome extension API is available, so some extensions only work partially.
- Cookies can only be imported from Firefox. Chromium-based browsers encrypt their cookies so other apps cannot read them.
- Website permission requests (camera, microphone, location, notifications) are currently always denied.

## Development

Requirements: Node.js 24 and Windows.

```bash
npm ci
npm run dev
```

| Command         | What it does                                    |
| --------------- | ----------------------------------------------- |
| `npm run dev`   | Start with hot reload                           |
| `npm run build` | Type-check and build into `out/`                |
| `npm start`     | Run the built app                               |
| `npm test`      | Run unit tests                                  |
| `npm run lint`  | ESLint and Prettier check                       |
| `npm run dist`  | Build the Windows installer into `dist/`        |
| `npm run icons` | Regenerate `app.png` / `app.ico` from `app.svg` |

### Releasing

1. Bump `version` in `package.json` (for example `0.2.0`) and commit.
2. Push a matching tag:

   ```bash
   git tag v0.2.0
   git push origin main v0.2.0
   ```

3. GitHub Actions builds the installer and publishes the release. Installed browsers pick it up on their next start.

### Tech stack

Electron, TypeScript, electron-vite, vanilla HTML/CSS (no UI framework), SQLite via `node:sqlite`, electron-builder and electron-updater.

### Project structure

```
src/main/      Browser core: tabs, windows, IPC, storage, downloads, extensions, updates
src/preload/   Bridge between the UI and the core
src/ui/        Browser chrome: tab strip, address bar, bookmarks bar
src/pages/     Internal pages (home, bookmarks, downloads, settings, extensions, performance)
src/shared/    Shared types, settings, icons and IPC client
src/splash/    Startup window
assets/        Fonts and icons
```
