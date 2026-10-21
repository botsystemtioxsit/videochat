# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

«ВидеоЧат» — **group video rooms for Telegram chats** (a stable replacement for Telegram's own group video calls), part of the "Тролль-Баттл" project. One room per connected Telegram chat; everyone in the chat can join, see and hear each other, and chat in text. It is a third app on the **same Firebase Realtime Database** (`zolotaya-kletka`, Spark/free plan — **no billing, ever**, same non-negotiable constraint as the sibling repos `index.html` (the game), `battle-admin-bot` (the admin panel + the role-gateway Worker) and `launcher`). No server of its own, no build step: the whole app is one static file, **`index.html`** in the repo root (GitHub Pages from `main` / root: `https://botsystemtioxsit.github.io/videochat/`), plus `desktop/` — an Electron window that opens that live page (same idea as the game's and the panel's desktop apps). (There used to be a random 1-to-1 "chatroulette" mode in v1.0; the owner dropped it — don't bring it back.)

- Video/audio: LiveKit (`livekit-client` from CDN), tokens from the **LiveKit sandbox token server** — the same ID as the game (`LIVEKIT_TOKEN_SERVER_ID`). It is an official dev/pre-alpha mechanism with weak rights; a production token server is a separate decision for the owner. LiveKit room name = `vcg-<chatId>`.
- Look: dark Telegram-blue background (`--bg #0e1621`) with green glow (`--accent #35e08f`) — chosen by the owner, deliberately different from the game's palette. Logo = the admin panel's gear (`desktop/icon.png`, a placeholder the owner will replace).
- Plain page: don't add a bundler/framework. No obfuscation build (unlike the game/panel) — ask the owner before adding one.

## How a Telegram chat gets a room (bot = the "Терминал" bot, handled by the role-gateway Worker in `battle-admin-bot`)
1. The bot is added to a group. A chat **administrator** sends `/connect` → the Worker checks with Telegram (`getChatMember`) that the sender is creator/administrator, writes `videochat/communityRequests/<chatId>` and messages the owner (`OWNER_IDS`).
2. The owner approves it in the admin panel (ВидеоЧат → Сообщества). The requester becomes the community's **sub-admin**; a room (`videochat/communities/<chatId>`, with a 6-char `joinCode`) appears.
3. Anyone in the chat sends `/call` → the bot answers with a button `https://botsystemtioxsit.github.io/videochat/?room=<chatId>` and the code. The page also accepts the code typed in the lobby.
4. Before entering, the page asks the Worker `POST /vc-membership {communityKey, userId}` → Worker calls `getChatMember` → only chat members get in (the owner always can). Guests (`guest_…`) cannot enter chat rooms — a real account (login by approval request) is needed. A positive answer is cached 6 h in `localStorage`.

## Identity and accounts — shared with the game

- Same `users/<id>` record as the game (`playerId` PLR-…, `firstName`, `role`, `status`, `restrictedUntil`…). A guest/new Telegram user gets the same default record created by `ensureUser` (no `owners/` binding, no Firebase Auth anywhere — **never add Firebase Auth**).
- Login = the shared approval flow: `emailLogins/<emailKey>` / `usernames/<key>` / numeric id → push to `users/<id>/loginRequests/<pushId>` with `app: 'videochat'` → the Worker sends the Telegram message («Запросили вход в ВИДЕОЧАТ») via `/login-notify`; approve in Telegram, in the game (Сообщество → Запросы) or in the admin panel (Аккаунт). The approved id goes to `localStorage.battleTelegramId` — the same key the game and the panel use. The human tap on «Разрешить» is the real boundary (no email verification — deliberate).
- Rules gate once per account: `users/<id>/videochatAccepted` (timestamp). `users/<id>/vcJoined/<chatId>` = last join time (the lobby's «Мои комнаты»). `users/<id>/vcCommunities/<chatId>` = the person's rank in that room (written by the panel; see below).
- Platform checks the page enforces (UI-level like everywhere in this project — the DB is open): game ban/restriction (`users/<id>/status`, `restrictedUntil`), platform-wide video-chat ban (`videochat/bans/<id>`, live), `config/emergencyLockdown`, `config/maintenanceMode` (not staff). `config` is read flag by flag, never as a whole node — it holds secrets.

## Database layout (`videochat/`)

- `communities/<chatId>` = `{title, status:'active'|'disabled', joinCode, createdAt, createdBy, tgChatId, settings:{autoMod}, staff:{<uid>:'subadmin'|'admin'|'miner'}}` — light meta; the panel reads the whole node (index `.indexOn: joinCode` in `database.rules.json` of the `index.html` repo). `<chatId>` is the Telegram chat id (negative number, e.g. `-1001234567890`) — it is also the room key.
- `roomState/<chatId>/` — live state, kept apart from the meta on purpose: `online/<uid>` = `{name, rank, at}` (own presence, `onDisconnect().remove()`), `mutes/<uid>` and `bans/<uid>` = `{until (ms; 0 = no end), by, byName, at}`, `votes/<target>/<voter>` = timestamp, `logs/<pushId>` = `{at, actor, actorName, actorRank, action, target, targetName, details}`.
- `communityRequests/<chatId>` = `{chatId, title, requestedBy:{id,name,username}, at, status:'pending'|'approved'|'rejected'}` — written by the Worker.
- `bans/<uid>` = platform-wide ban (admin panel, tab «Блокировки»).
- The rooms are **isolated**: staff of one room only manage that room (admin panel: the «Моя комната» app); the owner (superadmin) and `app_videochat` admins manage all.

## Ranks and moderation in a room
Owner (superadmin, never mutable) > `subadmin` (appointed by the owner; appoints admins and miners in their room) > `admin` (mute any time, kick = 1 h ban, ban; appoints miners) > `miner` («минер», the lowest: mute up to 30 minutes only) > member. A person can act only on someone **below** their rank. Staff act from the «Участники» tab in the room or from the panel; every action is logged to `roomState/<id>/logs` and to the global `logs` as `vcg_action` (owner audit).
- **Enforcement is client-side on every honest client**: a muted person's own client turns the mic off and blocks chat; **everyone else's client unsubscribes from the muted person's audio and ignores their chat messages**, and hides a banned person — so a modified client cannot speak over a mute for the others. The database is open, so this is moderation, not a security boundary (same as the rest of the project).
- **Autonomous voting**: if the room's settings allow it (`autoMod !== false`), there is **no staff online** and **≥ 5 people** are in the room, any member can vote to mute another non-staff member. A vote lives 5 minutes; the target is muted while valid votes (from people currently in the room) ≥ `max(3, ceil((online − 1) / 2))`. It is computed locally by everyone from `votes` — nothing is written when the threshold is reached, so it expires by itself.
- LiveKit identity = `<uid>~<random>`; each client announces `{t:'hi', uid, name}` as a data message (and answers newcomers once), which is how a LiveKit participant is tied to an account. The owner is recognised by reading `users/<uid>/role === 'superadmin'` (clients cannot write that role — see the rules).

### Call flow
Lobby → room (`?room=<id>` or code) → LiveKit connect → mic/camera on → tiles grid (speaking = green glow), side panel «Чат» / «Участники». Leaving or losing the connection returns to the lobby. Chat = LiveKit data messages (`{t:'chat', text}`), ≤ 300 chars, rendered with `textContent`.

## Moderation (admin panel)
In `battle-admin-bot` (`src/admin.html`, panel v5.26+): see its CLAUDE.md («Several apps in one panel» → «ВидеоЧат communities»). If you change the schema above, change `vcOpenOverview` / `renderVcCommunities` / `cm*` there too.

## Desktop (Electron) — `desktop/`
`main.js` opens `https://botsystemtioxsit.github.io/videochat/`; the page updates itself by deploy, only the wrapper is versioned (`desktop/package.json`, **bump `version` when `desktop/` changes** — a release is only created for a new version). Allows only the `media` permission (camera + microphone). `electron-builder` `productName` is **«ВидеоЧат»** — the TIOXSIT Launcher finds the installed app by that exact registry name / `ВидеоЧат.exe` (see `Catalog.cs` in the `launcher` repo; keep both in sync). Workflows `build-windows-installer.yml` / `build-linux-installer.yml` publish `latest.yml` + installers to a GitHub Release `v<version>` on every push to `main` that touches `desktop/` — that release is what the launcher downloads. First release has to be triggered once (Actions → Build Windows installer → Run workflow) or by the first push of `desktop/`. `desktop/package-lock.json` is required by `npm ci` — regenerate it with `npm install --package-lock-only` after changing dependencies.

## Commands
No build, lint or test suite. Validate edits to `index.html` with the extract-and-`new Function()` script from the sibling repos' CLAUDE.md (extract every non-`src` `<script>`, check it parses, check `<div>` balance, no duplicate ids, every `$('id')` has an element). For behaviour use Playwright with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, routing the CDN scripts to stubs (fake `firebase`, fake `LivekitClient`) — the sandbox cannot reach Firebase, LiveKit or Telegram, so real calls cannot be tested from here. A useful check after touching the room code: several pages sharing one fake database and one fake LiveKit hub (staff mutes a member → the member's banner appears; 5 members without staff vote → the target is muted).

## Working agreement with the owner
The owner is non-technical and Russian-speaking (often dictates by voice). Standing rules, set by them:
- **Do what is asked and publish it.** For a requested task, finish it, open the PR, merge it, check the result and report — no separate "may I publish?" step.
- **Your own ideas: ask first.** Anything not asked for (extra features, clean-ups, deleting things) is proposed as a short yes/no question before doing it.
- **Say what limits you**, plainly (cannot see the phone or PC, cannot enable GitHub Pages or set GitHub/Cloudflare secrets, cannot run real video calls from the sandbox).
- **Write short and plain.** Lead with what happened or what to do; no jargon; one check at a time.
