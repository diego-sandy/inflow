# Changelog

All notable changes to inflow are documented here. This project follows
[semantic versioning](https://semver.org/) and the format of
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **MCP connector** — Claude Desktop (or any MCP client) can read your
  network and inbox and draft messages into a review queue, through a small
  companion installed from `inflow.mcpb`. Tools cover connections, network
  stats, conversations, threads, message search, people to reconnect with,
  finding someone outside your network, and creating, editing and deleting
  drafts.
- **What Claude can do** — Settings › AI › Claude (or "Claude permissions" in
  ⌘K) has one switch per kind of action: read and draft (on), tidy the inbox
  (archive, read/unread, Focused/Other, star), answer invitations, send
  messages (at most 15 an hour), and delete conversations — all off until you
  turn them on. Sending keeps the Outbox's rules: held drafts stay held, and a
  Claude InMail still needs you to confirm the person. AI Chat only reads.
- **Review queue** — drafts and scheduled messages in a split view: the queue
  on the left, the selected message in full on the right. j/k to move through
  it. Edit in place, schedule, or send; scheduled messages can send
  themselves (on by default, never long after their time).
- **Premium InMail** — write to people outside your network, with a subject.
  Drafts Claude makes for them must be confirmed against the person's profile
  before they can send.
- **Held drafts** — an InMail follow-up to someone who hasn't answered your
  last InMail is held ("Waiting for their reply") instead of failing at send,
  and Claude can't create one. When someone replies after a draft to them was
  written, it waits for you to look again ("They replied"); it is never
  released on its own.
- **Invitations** — pending connection requests under Connections, with
  Accept / Ignore and the note beside them.
- **Inbox** — renamable tabs, an InMail view, unread badges, mark as unread,
  Drafts and Scheduled from the tab row, and scheduled replies.
- **AI Compose** — describe a message, review the AI's draft, then send.
- **AI Chat** — streamed answers, searches the relevant part of your network
  first, editable starter questions and instructions. With Claude and the
  connector, it can look things up for itself.
- **AI providers per task** — pick Claude or Gemini, and the model, for fast
  and for quality work separately. Keys can live in the connector instead of
  the browser.
- **Setup wizard** — a first-run walkthrough (LinkedIn, pinning, AI keys,
  the MCP connector), reopenable from Settings › Setup.
- **Connections sync** — incremental and paced: a visit checks for new
  connections, large networks fill in gradually, and it backs off when
  LinkedIn throttles.
- **AI keys** — replace a saved key in place, see where the full key lives,
  and confirm before removing one.
- **New inflow mark** across the toolbar, the app and the connector.
- **Themes** from the nav rail, and `g` + letter to reach every section.

### Changed
- **AI models** — Claude Haiku 5.5 / Sonnet 5.5 / Opus 5.5 and Gemini
  3.5 Flash-Lite / 3.8 Flash; a saved older choice moves to its successor.
- **Composer** — one field with a slim toolbar, round send button and a soft
  character counter.
- **Connector pairing** — both sides now prove they hold the pairing code
  without ever sending it, and inflow answers nothing until the connector
  has proved itself. Reinstall `inflow.mcpb` once after updating.
- **Releases** check that the AI models inflow offers are still current.
- **MCP connector setup** — the Tool permissions step now says that Always
  allow also covers the actions you turn on in Settings › AI › Claude, and its
  drawing shows the real number of tools. Claude's description of inflow says
  it can act once you allow it; reinstall `inflow.mcpb` once to see it.
- **Messages folders** — one dropdown holds every folder: Primary (the
  default) and Other, then Drafts and Scheduled with their counts, then
  Archive and Spam. Unread is now a switch, so it's plain when it's on. The
  1–4 keys still go to Primary, Other, Archive and Spam.

### Fixed
- **Open conversation lands on the right tab** — from a contact in
  Connections, or a reply link in the Outbox, it now opens the conversation in
  the tab it lives in (Primary, Other, Archive…), instead of the top
  conversation of whichever tab you had open last.
- **AI Chat follows the conversation with Claude** — follow-up questions now
  reach Claude with the earlier turns of the chat, so "which of them…" knows
  who "them" is. It already worked this way with Gemini.
- **Composer drafts** — moving past a conversation before its draft loaded
  deleted it; a slow load could overwrite what you'd typed; changing a new
  message's recipients wiped it.
- **AI errors** — a failed AI call says why (including a rejected key, and
  how to fix it) instead of "The AI returned nothing".
- **Live updates** — reactions and edits no longer wipe a message's "seen"
  mark or attachments; a receipt that arrives before its message is kept;
  photos arriving live show in the preview; replying from another device
  marks the thread read; messages in Other no longer raise a desktop
  notification or jump to Primary.
- **Actions** — archive, star, move and delete now apply to both halves of a
  conversation LinkedIn split in two; a failed action no longer undoes a
  later one or makes a thread vanish; a thread in Other can move back to
  Focused.
- **Sync** — videos you receive are visible; a network stall no longer shows
  the login screen; a stuck upload no longer blocks later sends; caches no
  longer grow without limit; folders are no longer re-read end to end every
  15 minutes.
- **Inbox** — a search no longer leaves the list blank or shows another tab's
  results; filters mid-search work; the selection no longer jumps to someone
  else when a thread is still saving.
- Many of these fixes are ported from the upstream project, each checked
  against this codebase with a test first.

## [0.5.0] - 2026-08-09

### Added
- **Connections section** — browse your full first-degree connection list
  (no longer capped at 40), with search by name/headline and sorting by date
  added, first name, or last name.
- **AI categorization** — connections are sorted into role categories
  (Investor, Founder, Engineering, …) and matched against your own interest
  tags (e.g. "Investors"), so you can filter your network. Choose **Auto**
  (categorize after each sync) or **Manual** in Settings → AI.
- **AI summaries** — a one-line summary of each connection in the detail pane,
  plus a per-connection **Refresh** to re-analyze someone.
- **Insights** — a new section showing your network's composition by role,
  interest breakdown, and the firms your connections cluster around.
- **Ask your network** — a chat in Insights (the "Ask" tab) to ask
  natural-language questions about your connections, grounded in your data.
- **Settings panel** — a proper Settings window (gear in the nav rail or ⌘,)
  with AI, Appearance, Backup, Advanced, and About sections.
- **Backup & restore** — save your connections and everything the AI derived
  to a versioned JSON file in a folder you choose, with optional auto-backup
  after categorizing. Restores correctly across future updates.
- **What's new** — this window: release notes shown once after each update
  (also available anytime from Settings → About or the command palette).

### Fixed
- **Categorization failures are now visible** — a failed batch (e.g. a rate
  limit) surfaces a notice with a Retry action instead of silently stopping.
- **Toggle switches** — the switch knob no longer overflows the pill.
- **Nameless connections hidden** — connections that come back without a
  resolvable name (private/restricted profiles) no longer show as "Unknown"
  rows; they stay stored and reappear if a later sync resolves them.

### Changed
- **AI setup moved into Settings** — the API key, get-a-key instructions, and
  reply-suggestion toggle now live in Settings → AI (previously a
  command-palette-only modal).
- **Build-numbered versions** — production builds now carry a 4th version
  segment (e.g. `0.5.0.461`) so every published build is uniquely identifiable;
  the human version stays 3-part (`0.5.0`).

## [0.4.0] - 2026-07-13

### Added
- **Sender avatars in notifications** — native Chrome notifications now show
  the sender's profile picture (circle-cropped) instead of the generic app
  icon, with the app icon as fallback when the avatar can't be loaded.
  Requires a new `media.licdn.com` host permission.
- **Avatar rail on narrow windows** — below 700px window width the
  conversation list collapses to a compact avatar-only rail (unread dot and
  star badges, name + preview on hover) so the thread keeps usable width.
  Keyboard navigation works unchanged.
- **Demo mode fires native notifications** — simulated incoming messages now
  produce real OS notifications (when the app isn't focused), matching
  production behavior.

### Fixed
- **Thread pane layout at narrow widths** — the contact name no longer
  overflows into the header buttons, header buttons no longer wrap or clip,
  and message bubbles are no longer squeezed by the invisible hover-actions
  strip (which also no longer intercepts clicks while hidden).
- **Missed notifications after switching apps** — notifications were wrongly
  suppressed when inflow was the active tab but Chrome wasn't the frontmost
  app. Suppression now requires the window to actually have OS focus.
- **Composer stays focused after sending a message.**
- **Rate limits and network blips no longer pile up as errors** in
  chrome://extensions — transient failures (timeouts, dropped connections,
  HTTP 429/5xx) log as warnings and recover on their own.

### Changed
- **Removed profile scraping** — the extension no longer calls LinkedIn's
  identity API. Everything shown (names, avatars, headline, location) comes
  from messaging data. Company/title display, the company logo badges, and
  the `company:` search filter are gone; demo mode people no longer have
  fabricated companies or roles.

## [0.3.6] - 2026-07-10

### Fixed
- **Notification clicks now open the right conversation** — clicking a native
  message notification (or the in-app toast) opens the app focused on that
  specific thread instead of just raising the window.
- **Mark-as-read now reliably syncs to LinkedIn** — outbound read/unread
  requests are checked against the response body, so a silently-rejected
  batch update surfaces as an error instead of appearing to succeed.
- **Read/unread toggled on LinkedIn now reflects in inflow** — a thread marked
  read or unread on another device is reconciled from the authoritative server
  flag for any conversation, not just the top of the focused inbox. Optimistic
  local state is preserved while a mutation is in flight.

### Changed
- Redundant conversation refetches triggered by realtime echoes are coalesced
  into far fewer network calls.

## [0.3.5] - 2026-07-05

### Added
- **Resizable sidebar** — drag the divider between the conversation list and
  the thread to resize it (280px up to 60% of the window); double-click the
  divider to reset. Your chosen width persists across sessions. Thanks
  @sharkymark for the suggestion (#6).
- When the sidebar is narrow, the Focused/Other/Archive/Spam tabs collapse
  into a compact dropdown so the header never overflows.

### Changed
- README: install steps moved to the top (#7) and screenshots now illustrate
  the feature tour.

## [0.3.4] - 2026-07-05

### Fixed
- **Blank app on load** — opening inflow could intermittently show an empty
  conversation list until a (lucky) reload. The first render raced the local
  database opening; queries that lost the race never recovered. They now
  reconnect the moment the database is ready.

### Changed
- **Much faster folder switching** — the conversation list now renders only
  the rows in view instead of every conversation in the folder, batches its
  per-row lookups, and skips re-rendering unchanged rows during background
  sync. Switching between Focused/Other/Archived/Spam is instant even with
  hundreds of conversations, and revisiting a folder paints immediately from
  memory.

## [0.3.3] - 2026-07-05

### Fixed
- **Duplicate bubble after sending** — a message you just sent could briefly
  show twice (the copy stored from the send response and the realtime echo
  carry timestamps a few ms apart) until the next thread refresh reconciled
  it. The two copies now collapse immediately.

## [0.3.2] - 2026-07-05

A deep sync-consistency release: a systematic audit of everything flowing
between LinkedIn and inflow, with 31 fixes — each locked in by a regression
test (the suite grew to 656 tests).

### Added
- **Cross-device star sync** — starring or unstarring a conversation on the
  LinkedIn website or your phone now updates inflow live, in both directions.
- **Unsend sync** — when someone unsends a message, it disappears from inflow
  immediately instead of lingering until the next refetch. Previously-stored
  copies of recalled messages are cleaned up too.
- **Deletion sync** — conversations you delete on the LinkedIn website (or
  another device) are now removed from inflow instead of living there forever.
  Conservative by design: a conversation must be absent from two consecutive
  full syncs before it's removed.

### Fixed
- **Unread accuracy** — a batch of fixes for unread indicators that were wrong
  or stuck:
  - A sync page fetched moments before a new message arrived could clear the
    unread dot for a message you never saw.
  - Someone editing or reacting to an *old* message no longer marks the thread
    unread, pulls it out of Archive, or fires a "new message" notification.
  - Duplicate threads with the same person (InMail + regular) are shown merged,
    but the hidden twin's unread could never be cleared — the thread stayed
    unread forever and inflated the badge.
  - The toolbar badge now counts exactly what the Focused list shows.
- **Message ordering and timestamps** — sent messages now get their real server
  timestamp immediately from the send response instead of the local clock, and
  a skewed system clock can no longer make the background sync silently skip
  newly arrived messages.
- **Group chats** — a message from a participant we hadn't synced yet could
  render as "You" and later show duplicated. Senders are now resolved from the
  event itself.
- **Folder consistency** — moving an archived conversation to Other or Spam no
  longer leaves it visible in Archived as well, and archive followed by a quick
  undo can no longer land on LinkedIn out of order and snap back.
- **Deleted conversations stay deleted** — a sync page fetched just before a
  local delete could silently resurrect the conversation.
- **Unsent messages** no longer leave an orphaned timestamp in the thread when
  they were the only message under it.
- **Shared post previews** refresh after a week — a post that failed to load
  once was cached as missing forever.
- **Large mailboxes** — the initial full sync no longer monopolizes the sync
  engine for hours; it works in short rounds so read-state reconciliation keeps
  running throughout.
- **Sign-in after startup** — interrupted sync items now recover on the next
  cycle instead of waiting for a browser restart; same after an account switch.
- **Toolbar icon clicks while dragging a tab** no longer error and do nothing —
  the click retries once the drag ends.

### Changed
- Database schema v12 (automatic, data-preserving migration).

## [0.3.1] - 2026-06-27

### Fixed
- **Compose to new contacts** — sending a first message to a recently connected
  person no longer fails with a misleading "not connected" error. The
  `createMessage` payload was missing a required field (`hostRecipientUrns`).

## [0.3.0] - 2026-06-27

### Added
- **Check for updates** command in the command palette (`Cmd+K`) for an on-demand
  release check.
- The running version is now shown on the keyboard shortcuts bar.

### Fixed
- Update checks now run reliably — the GitHub API host is declared, so the
  background check is no longer blocked.
- The `?` (shortcuts) and `!` (mark as spam) shortcuts now work on non-QWERTY
  keyboard layouts such as AZERTY. Thanks @qchuchu (#4).

### Removed
- The WhatsApp community top banner — the button in the conversation header
  already covers it.

## [0.2.0] - 2026-06-27

First public GitHub release, with in-app update notifications.

> [!IMPORTANT]
> **Existing users: this is a one-time fresh start.** This build pins a stable
> extension ID so all future updates preserve your data. Moving from an older
> build changes the extension's identity once, so inflow will open empty —
> re-enter your Gemini key (if you use AI features) and let it re-sync. This
> only happens this once; every release after this keeps your data.

### Added
- **Update notifications** — inflow now checks GitHub for new releases and shows
  a banner with a link to the release notes when an update is available.
- **GitHub Releases** — each version ships a downloadable `inflow-<version>-chrome.zip`.
- **Stable extension ID** — updates (zip download or rebuild) now preserve your
  conversations and settings regardless of where the extension folder lives.
- New envelope app icon.

### Fixed
- New conversations started from another device (e.g. your phone) no longer show
  the participant as "Unknown".
- A conversation read on another device now reflects as read in inflow, even
  while the realtime connection is active.

## [0.1.0]

Initial pre-release builds (shared informally before GitHub Releases).

[0.3.5]: https://github.com/grinich/inflow/releases/tag/v0.3.5
[0.3.4]: https://github.com/grinich/inflow/releases/tag/v0.3.4
[0.3.3]: https://github.com/grinich/inflow/releases/tag/v0.3.3
[0.3.2]: https://github.com/grinich/inflow/releases/tag/v0.3.2
[0.3.1]: https://github.com/grinich/inflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/grinich/inflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/grinich/inflow/releases/tag/v0.2.0
