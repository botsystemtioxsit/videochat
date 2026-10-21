# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

«ВидеоЧат» — random 1-to-1 video chat (like Chatroulette) from the "Тролль-Баттл" project. It is a third app on the **same Firebase Realtime Database** (`zolotaya-kletka`, Spark/free plan — **no billing, ever**, same non-negotiable constraint as the sibling repos `index.html` (the game), `battle-admin-bot` (the admin panel) and `launcher`). No server, no Cloud Functions, no build step: the whole app is one static file, **`index.html`** in the repo root (served by GitHub Pages from `main` / root: `https://botsystemtioxsit.github.io/videochat/`), plus `desktop/` — an Electron window that opens that live page (same idea as the game's and the panel's desktop apps).

- Video/audio: LiveKit (`livekit-client` from CDN), tokens from the **LiveKit sandbox token server** — the same ID as the game (`LIVEKIT_TOKEN_SERVER_ID`). It is an official dev/pre-alpha mechanism with weak rights; a production token server is a separate decision for the owner. Rooms are named `vc-<roomId>`.
- Pairing: only through the RTDB (below), no custom signalling server.
- Plain page: don't add a bundler/framework. No obfuscation build (unlike the game/panel) — ask the owner before adding one.

## Identity and accounts — shared with the game

- Same `users/<id>` record as the game (`playerId` PLR-…, `firstName`, `role`, `status`, `restrictedUntil`…). A guest/new Telegram user gets the same default record created by `ensureUser` (no `owners/` binding, no Firebase Auth anywhere — **never add Firebase Auth**).
- Login = the shared approval flow: `emailLogins/<emailKey>` / `usernames/<key>` / numeric id → push to `users/<id>/loginRequests/<pushId>` with `app: 'videochat'` → the role-gateway Worker sends the Telegram message («Запросили вход в ВИДЕОЧАТ») via `/login-notify`; approve in Telegram, in the game (Сообщество → Запросы) or in the admin panel (Аккаунт). The approved id goes to `localStorage.battleTelegramId` — the same key the game and the panel use. The human tap on «Разрешить» is the real boundary (no email verification — deliberate, see the other repos).
- Guest = `guest_<random>` kept in `localStorage.vcGuestId`.
- 18+ / rules gate once per account: `users/<id>/videochatAccepted` (timestamp).
- Access control the page enforces (UI-level like everywhere in this project — the DB is open): game ban/restriction (`users/<id>/status`, `restrictedUntil`), video-chat ban (`videochat/bans/<id>`, live listener → throws the person out of the call), `config/emergencyLockdown` (everyone), `config/maintenanceMode` (not staff). `config` is read flag by flag (`emergencyLockdown`, `maintenanceMode`, `*Message`), never as a whole node — it holds secrets.

## Database layout (`videochat/`)

- `online/<uid>` = `true` (+ `onDisconnect().remove()`) — own presence, not the game's `presence`.
- `queue/<uid>` = `{at: ServerValue.TIMESTAMP}` — waiting for a partner (index `.indexOn: at` in `database.rules.json` of the `index.html` repo).
- `locks/<uid>` = `{room, by, at}` — see matching. `pairs/<uid>` = `{room, peer, at}` — "you have been paired" notice for the waiting side. `rooms/<roomId>` = `{a, b, at}`.
- `reports/<pushId>` = `{from, fromName, fromPlayerId, target, room, reason, createdAt, status: 'new'|'closed'}` — written by the page, handled in the admin panel (tabs «Жалобы и блокировки»). Index on `status`.
- `bans/<uid>` = `{until (ms; 0 = forever), reason, at, by}` — written by the admin panel.
- Added to `users/<id>`: only `videochatAccepted`. Nothing else of the game's record is touched.

### Matching (don't "simplify" it — it is race-proof on purpose)
Everyone writes `queue/<me>`, then (a) listens to `pairs/<me>` and (b) scans the 25 oldest queue entries. **Only the later arrival initiates** towards earlier ones (so two people can never pick each other at once). The initiator takes two `locks` with transactions "empty → value" (first its own — "has someone already taken me?", then the candidate's), writes `rooms/<id>` and the candidate's `pairs/<cand>` in one update, removes the candidate's queue entry and proceeds. A failed second lock releases the first and moves to the next candidate. Locks older than 15 s count as abandoned; they are released 5 s after a successful pairing. Candidates that are not in `videochat/online` are skipped (ghosts). In a transaction callback always return the new value when `cur === null` (the local cache may be empty; the server re-checks) and `undefined` to abort. Two-client simulation of this lives only in the author's scratch tests: 4 clients pressing "find" at once must end as 2 pairs with an empty queue — redo that check after touching this code.

### Call flow
`lobby → searching → connecting → incall`. Peer leaves / doesn't show up in 20 s / connection lost → toast and automatic new search. «Дальше» = leave + search again (1.2 s cooldown), «Выйти» = back to the lobby. Chat goes through LiveKit data messages (`{t:'chat', text}`), ≤300 chars, rendered with `textContent`. A complaint blocks that person locally (`localStorage.vcBlocked`) so they are never matched again.

## Moderation (admin panel)
In `battle-admin-bot` (`src/admin.html`, panel v5.25+): a superadmin gives an admin the right «Администрирует приложение «ВидеоЧат»» (`users/<uid>/permissions/app_videochat`); only then the admin sees the ВидеоЧат tabs, and an admin without `app_troll` does not see the game's tabs. Full rules in that repo's CLAUDE.md («Several apps in one panel»). If you change the schema above, change `vcOpenOverview`/`vcOpenModeration` there too.

## Desktop (Electron) — `desktop/`
`main.js` opens `https://botsystemtioxsit.github.io/videochat/`; the page updates itself by deploy, only the wrapper is versioned (`desktop/package.json`, **bump `version` when `desktop/` changes** — a release is only created for a new version). Allows only the `media` permission (camera + microphone). `electron-builder` `productName` is **«ВидеоЧат»** — the TIOXSIT Launcher finds the installed app by that exact registry name / `ВидеоЧат.exe` (see `Catalog.cs` in the `launcher` repo; keep both in sync). Workflows `build-windows-installer.yml` / `build-linux-installer.yml` publish `latest.yml` + installers to a GitHub Release `v<version>` on every push to `main` that touches `desktop/` — that release is what the launcher downloads. First release has to be triggered once (Actions → Build Windows installer → Run workflow) or by the first push of `desktop/`. `desktop/package-lock.json` is required by `npm ci` — regenerate it with `npm install --package-lock-only` after changing dependencies.

## Commands
No build, lint or test suite. Validate edits to `index.html` with the extract-and-`new Function()` script from the sibling repos' CLAUDE.md (extract every non-`src` `<script>`, check it parses, check `<div>` balance, no duplicate ids, every `$('id')` has an element). For behaviour use Playwright with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, routing the CDN scripts to stubs (fake `firebase`, fake `LivekitClient`) — the sandbox cannot reach Firebase or LiveKit, so real calls cannot be tested from here.

## Working agreement with the owner
The owner is non-technical and Russian-speaking (often dictates by voice). Standing rules, set by them:
- **Do what is asked and publish it.** For a requested task, finish it, open the PR, merge it, check the result and report — no separate "may I publish?" step.
- **Your own ideas: ask first.** Anything not asked for (extra features, clean-ups, deleting things) is proposed as a short yes/no question before doing it.
- **Say what limits you**, plainly (cannot see the phone or PC, cannot enable GitHub Pages or set GitHub/Cloudflare secrets, cannot run real video calls from the sandbox).
- **Write short and plain.** Lead with what happened or what to do; no jargon; one check at a time.
