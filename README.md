# Ping Pong Tournament Manager

A small, self-contained web app for running an informal single-elimination
ping pong tournament: a live-updating bracket, a click-to-score scoreboard,
and a check-in flow for adding/removing players as people show up.

No build step, no server, no dependencies. It's just `index.html`,
`styles.css`, `app.js`, and `engine.js` — open the file or host it anywhere
that serves static files, including GitHub Pages.

## Deploying to GitHub Pages

1. Create a new repository on GitHub (or use an existing one).
2. Copy these four files into the repo root: `index.html`, `styles.css`,
   `app.js`, `engine.js`. (`test-engine.js` is optional — see Testing below.)
3. Commit and push:
   ```
   git add index.html styles.css app.js engine.js
   git commit -m "Add tournament app"
   git push
   ```
4. On GitHub: **Settings → Pages → Build and deployment → Source**, choose
   **Deploy from a branch**, pick `main` (or your default branch) and `/`
   (root), then Save.
5. GitHub gives you a URL like `https://yourname.github.io/your-repo/` —
   that's the live site. It usually takes a minute to go live after the
   first push.

Any time you want to change something, just push an update to the same
files — Pages redeploys automatically.

## How it's organized

Create a tournament from the home screen (paste your interest-form names in
while creating it — that list is only used for the read-only reference
bracket). Each tournament has three tabs:

- **Dynamic Bracket** — the live bracket. This is what you run the actual
  event from. Click any match card with two players in it to open the
  scoreboard.
- **Check-In** — add a name as each person arrives; two waiting names
  automatically pair into a new first-round match. Remove a name if someone
  leaves before their match is played.
- **Preset Bracket** — a frozen, read-only bracket built once from the
  interest-form list you pasted in when creating the tournament. It's not
  connected to live check-ins at all — it exists purely as a fallback you
  can glance at (or print) if the live version ever has a technical hiccup.

### Scoring a match

Tap a match card to open the scoreboard: big score on each side, a `+` and
`−` button under each. Nothing is presumed for you — you tap `+`/`−`
however you're actually playing to 7, 11, 21, or anything else, and tap
**Lock game** yourself when it's decided. Locking is what finalizes the
result and advances the winner; the buttons refuse to lock a tied score.

Locking doesn't freeze the card forever — you can reopen a locked match and
tap **Unlock game** to fix a scoring mistake. That's intentional (per your
request, this is the safety net), but it will refuse to unlock if a later
round has already locked in a result that depended on this one; unlock that
later match first.

### Match lengths, deuce, and the sudden-death cap

Match length scales automatically with how many people actually check in
(not the interest-form count) and how much time you said you have when you
created the tournament. The final is always race-to-21 and the semifinal is
always race-to-11. Earlier rounds default to race-to-7, but if the field is
small enough that race-to-11 for those rounds too would still plausibly fit
your time budget, the app bumps them up to race-to-11 automatically. (This
is a rough estimate off match count and an assumed pace — not a promise —
see the constants at the top of the "time-budget" section in `engine.js` if
you want to tune the assumption.)

Real deuce rules apply automatically once you're scoring: you need a 2-point
lead to win once you've hit the target (so at 6-6 in a race-to-7, it keeps
going — first to lead by 2 wins, e.g. 8-6). To keep a deuce from running
forever, each target has a sudden-death cap: once **both** players have
reached it, the next point just wins outright:

| Race to | Deuce cap (next point wins once both reach it) |
|---|---|
| 7 | 11 |
| 11 | 21 |
| 21 | 31 |

The scoreboard applies this automatically — the match locks itself the
moment the score is actually decided, and you'll get a quick toast telling
you who won. You don't have to track the math yourself, and you still don't
have to tap `+`/`−` in real time if you'd rather enter a final score after
the fact — either way, it locks and advances the winner the moment the
result is legitimate. The manual **Lock game** button still exists too, as
an override for anything that doesn't fit the formula (a forfeit mid-game,
a shortened casual game, etc.) — it only refuses a tied score.

### Check-in and removals

Two players waiting with no match get paired automatically, in the order
they were added. If there's an odd one out, a banner offers a **Give bye**
button to auto-advance them once you're sure no one else is coming to pair
with them — or, if anyone's already been eliminated, a second option to
bring one of them back to actually play the waiting person instead of
handing out a free pass. That's a deliberate way to keep the bracket full
of real matches (and give people more game time) when the numbers don't
divide evenly, rather than defaulting to byes.

Removing a player only works before their current match is played:

- If they haven't played yet, they're pulled out cleanly and their
  would-be opponent (if they had one) goes back to the front of the line
  to be paired with the next arrival.
- If they'd already won a previous round and are waiting on their *next*
  match (which hasn't been played yet), removing them gives their
  upcoming opponent an automatic walkover into the next round.
- Once a match is actually locked in, the remove button is disabled for
  those players — that result is history. (If you genuinely need to undo
  it, unlock the match itself from the bracket instead.)

## How the bracket adapts (worth knowing before event night)

- The bracket size (and therefore how many rounds exist, and therefore the
  race-to-7/11/21 cutoffs) is recalculated from however many first-round
  matches currently exist. It grows as more people check in — you don't
  set a fixed size up front.
- Everything about a **locked** match is permanent — check-in changes never
  rewrite history. Only matches that haven't been played yet get
  reshuffled when the roster changes.
- Edge case worth knowing: if you keep adding new check-ins *after* the
  final has already been played and locked, the app may grow a new round
  beyond it to accommodate the bigger field, effectively reopening what
  looked like a finished tournament. In practice, for a single-table event
  this shouldn't come up — once the final is played, the event is over —
  but if you're testing with odd sequences, that's the explanation if you
  see it.
- A "bye" (from the Give Bye button) and a "walkover" (from removing
  someone who'd already advanced) are both final once locked — they can't
  be unlocked from the scoreboard, since there'd be no way to properly
  refill the empty slot. If you made a mistake, it's easiest to just
  re-add the player via Check-In as a fresh entry.

## Data & devices

Everything is saved to your browser's local storage — nothing leaves your
device, there's no login, and nothing is shared across devices or synced
to a server. That means: use the same browser on the same device for the
whole event, and don't clear that browser's site data mid-tournament.
Multiple tournaments are supported — they all live in the same browser
storage and show up on the home screen.

## Testing

`test-engine.js` is a small, dependency-free Node script that exercises
the bracket logic in `engine.js` directly (pairing, byes, walkovers,
locking/unlocking, race-to scaling). Run it with:

```
node test-engine.js
```

It's not needed for the app to run — it's just there if you want to poke
at the bracket logic or verify it after making changes.
