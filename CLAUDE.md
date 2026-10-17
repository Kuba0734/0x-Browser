
# 0x Browser

Eigener Desktop-Browser mit Fokus auf Performance und Minimalismus.
Performance hat Vorrang vor Optik: Wenn eine Design- oder Animationsregel die Performance spürbar verschlechtert, gewinnt die Performance.

## Tech-Stack
- Engine/Framework: Electron (Chromium), Tabs über `WebContentsView`
- Sprache(n): TypeScript (strict)
- Plattform: nur Windows
- Build: electron-vite (main / preload / renderer getrennt)
- Lint/Format: ESLint + Prettier
- Packaging: electron-builder (NSIS-Installer), kein Auto-Update
- Speicherung: SQLite für den Verlauf, JSON-Dateien für Settings und Bookmarks (atomar schreiben: temp-Datei + rename)
- Standard-Suchmaschine: Google (in Settings änderbar)
- UI: Vanilla HTML/CSS/TS, keine UI-Frameworks oder Animations-Libraries
- Interne Seiten laufen unter `0x://` (z. B. `0x://settings`, `0x://downloads`, `0x://performance`)


## Projektstruktur
- `src/main/` – Browser-Kern (Tabs, Fenster, Prozesse)
- `src/preload/` – Preload-Skripte, einzige Brücke zwischen UI und Kern (`contextBridge`)
- `src/ui/` – Browser-Oberfläche (Tab-Leiste, Adressleiste)
- `src/shared/` – gemeinsame Typen für Kern, Preload und UI
- `src/pages/` – interne Seiten (settings, bookmarks, downloads, extensions, performance)
- `assets/fonts/`, `assets/icons/` – lokale Schriften und Icons

## Arbeitsweise
- Antworte mir immer auf Deutsch
- Code (Variablen, Funktionen, Events, Dateinamen) auf Englisch
- Sichtbarer UI-Text auf Englisch
- Keine Code-Kommentare, außer bei nicht offensichtlichen Workarounds oder Sicherheitsentscheidungen
- Vor neuen Dependencies fragen
- Nach Änderungen Build und Lint ausführen, bevor du sagst, dass etwas fertig ist
- Lieber kleine, fokussierte Änderungen als große Umbauten

## Features (in dieser Reihenfolge umsetzen)
1. Kern: Tabs, Adressleiste, Navigation (vor/zurück/neu laden), Verlauf
2. Startup fenster mit Spinner bis alles geladen ist (wie operagx)
3. Bookmarks: anlegen, Ordner, Bookmark-Leiste
4. Downloads: Liste, Fortschritt, Pause/Abbrechen, Ordner öffnen
5. Settings: alle Design-Variablen und Verhalten einstellbar, sofort live übernommen
6. Performance-Seite: RAM/CPU pro Tab, Ladezeiten, Tabs schlafen legen, ...
7. Extensions: chrome extensions istallierbar und eigenen vom pc

## Performance
- Inaktive Tabs nach 3 Minuten schlafen legen
- Nichts im Hintergrund pollen; Events statt Timer
- Lazy-Loading für interne Seiten

## Sicherheit
- Webinhalte strikt vom Browser-Kern isoliert (Sandbox, keine Node-/System-APIs im Web-Content)
- Electron: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` für alle WebContents; Web-Tabs bekommen kein Preload mit Kern-Zugriff
- Interne `0x://`-Seiten sind von normalen Webseiten aus nicht erreichbar
- Keine Telemetrie, keine externen Requests außer den vom Nutzer aufgerufenen Seiten

## Logging
- Nur Crashes, Renderer-Abstürze und fehlgeschlagene Downloads/Updates
- Format: Zeitstempel, Level, Modul, Meldung
- Keine URLs oder persönlichen Daten in Logs

## Design
Gilt nur für die Browser-Oberfläche und interne Seiten, nie für Webinhalte.
- Modern, clean, dunkel, hochwertig
- Monochrom: Schwarz, Weiß, Grau. Akzent `--accent` (Weiß), Text darauf `--on-accent`
- `--danger` und `--success` nur für Fehler, Löschen und Erfolg
- Glassmorphism: halbtransparente Panels, `backdrop-filter: blur()`, 1px-Ränder `rgba(255,255,255,0.08)`; Blur nur auf wenigen, großen Flächen, nie auf vielen Listenelementen
- Leicht abgerundete Ecken, weiche Schatten, großzügige Abstände
- Schrift: Inter, lokal eingebunden
- Icons als Inline-SVG
- Alle Farben, Radien, Abstände und Animationszeiten als CSS-Variablen in `src/ui/tokens.css`

## Animationen
- Nichts erscheint oder verschwindet abrupt
- Nur `transform` und `opacity` animieren, keine Layout-Properties
- Standard-Easing: `cubic-bezier(0.22, 1, 0.36, 1)`, Dauer 150–300 ms
- Modals: Fade + Scale 0.95 → 1 + leichter Slide nach oben, schließen umgekehrt
- Listen erscheinen gestaffelt (40–60 ms pro Element, max. ~10 Elemente staffeln)
- Hover: `translateY(-2px)` + dezenter Glow; Klick: `scale(0.97)`
- Toasts sliden seitlich ein, mit ablaufender Fortschrittsleiste
- Zahlen auf der Performance-Seite zählen animiert hoch
- Ladezustände mit Skeleton-Shimmer
- Tab- und Seitenwechsel mit Crossfade
- Nur CSS-Transitions und `@keyframes`, keine Libraries
- `prefers-reduced-motion` und eine eigene Einstellung in Settings schalten Animationen fast komplett ab
- Tab-Leiste und Adressleiste reagieren immer sofort, Animationen dürfen Eingaben nie verzögern