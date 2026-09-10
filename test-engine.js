const E = require("./engine.js");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK: " + msg);
}

// --- Scenario 1: basic pairing as players check in ---
let s = E.createDynamicState();
const names = ["Alice", "Bob", "Carol", "Dave", "Eve"];
const players = {};
names.forEach((n) => {
  const p = E.addPlayer(s, n);
  players[n] = p;
});
// 5 players -> 2 matches formed (round1 slot0, slot1), 1 waiting in queue
assert(s.queue.length === 1, "one player waiting in queue after 5 check-ins, got " + s.queue.length);
assert(s.matches.filter((m) => m.round === 1).length === 2, "two round-1 matches formed from 5 players");

// race-to for round1 right now: round1MatchCount=2 -> n=4 -> R=2 -> distance for round1 = 2-1+1=2 -> raceTo 11
let R = E.computeRounds(s);
assert(R === 2, "R should be 2 with 2 round-1 matches (4 players), got " + R);
assert(E.raceToForRound(1, R) === 11, "round1 raceTo should be 11 at this field size, got " + E.raceToForRound(1, R));

// --- add 3 more players, field grows, round-1 match count grows ---
["Frank", "Grace", "Heidi"].forEach((n) => {
  players[n] = E.addPlayer(s, n);
});
// queue had 1 (Eve) + 3 new = 4 -> pairs off completely -> queue empty, 2 more matches -> total round1 matches = 4
assert(s.queue.length === 0, "queue empty after pairing up to 8, got " + s.queue.length);
assert(s.matches.filter((m) => m.round === 1).length === 4, "four round-1 matches for 8 players");
R = E.computeRounds(s);
assert(R === 3, "R should be 3 for 8 players, got " + R);
assert(E.raceToForRound(1, R) === 7, "round1 raceTo should be 7 once field reaches 8, got " + E.raceToForRound(1, R));
assert(E.raceToForRound(2, R) === 11, "round2 (semifinal) raceTo should be 11, got " + E.raceToForRound(2, R));
assert(E.raceToForRound(3, R) === 21, "round3 (final) raceTo should be 21, got " + E.raceToForRound(3, R));

// --- Scenario 2: score and lock a match, check propagation ---
const m0 = E.findMatch(s, 1, 0); // Alice vs Bob
E.scorePoint(s, 1, 0, "A", 7); // Alice to 7
let lockRes = E.lockMatch(s, 1, 0);
assert(lockRes.ok, "lock should succeed with a clear winner: " + JSON.stringify(lockRes));
assert(m0.winner === "A", "Alice should be marked winner");
const target = E.findMatch(s, 2, 0);
assert(target && target.playerA && target.playerA.name === "Alice", "Alice should propagate to round2 slot0 as playerA");

// --- Scenario 3: remove a player from an unplayed round-1 match -> survivor requeued ---
const m1 = E.findMatch(s, 1, 1); // Carol vs Dave, unplayed
const carolId = players["Carol"].id;
let rm = E.removePlayer(s, carolId);
assert(rm.ok, "removing Carol (unplayed) should succeed: " + JSON.stringify(rm));
assert(m1.status === "abandoned", "match 1-1 should be abandoned after Carol removed");
assert(s.queue.some((p) => p.name === "Dave"), "Dave should be back in queue after opponent removed");

// add a new arrival, should pair with Dave
E.addPlayer(s, "Ivan");
assert(s.queue.length === 0, "Ivan should immediately pair with Dave");
const newDaveMatch = s.matches.find((m) => m.round === 1 && ((m.playerA && m.playerA.name === "Dave") || (m.playerB && m.playerB.name === "Dave")) && m.status !== "abandoned");
assert(!!newDaveMatch, "Dave should be in a fresh round-1 match with Ivan");

// --- Scenario 4: cannot remove a player whose match is already locked ---
const aliceId = players["Alice"].id;
let rm2 = E.removePlayer(s, aliceId);
assert(rm2.ok === false, "removing Alice after her round-1 win is locked should be refused");

// --- Scenario 5: remove a player from round >= 2 unplayed match -> walkover ---
// First get Bob's match locked isn't needed; Alice already advanced to round2 slot0 as playerA.
// Fill round2 slot0 playerB via another path: lock match 1-2 (Frank vs Grace) or whichever pair.
const r1matches = s.matches.filter((m) => m.round === 1 && m.status !== "abandoned");
console.log("round1 matches now:", r1matches.map((m) => `${m.slot}: ${m.playerA && m.playerA.name} vs ${m.playerB && m.playerB.name} (${m.status})`));

// find the match feeding round2 slot0 as playerB (slot 1 in round1)
const feeder = E.findMatch(s, 1, 1); // this was abandoned Carol/Dave -> now should be Dave/Ivan reused slot? No, new match got new slot.
console.log("feeder slot1 status:", feeder && feeder.status);

// Instead, directly test walkover mechanics on round2: lock the match that feeds round2 slot0's playerB (slot index 1)
const slot1Match = s.matches.find((m) => m.round === 1 && m.slot === 1 === false); // no-op guard removed below

// Find whichever round-1 match has slot % 2 === 1 among slots 0/1 group (feeds round2 slot0 as B) and is still active
const feedsRound2Slot0B = s.matches.find((m) => m.round === 1 && m.slot === 1 && m.status !== "abandoned");
console.log("feedsRound2Slot0B:", feedsRound2Slot0B);

// The original slot 1 (Carol/Dave) is abandoned; Dave+Ivan got assigned a NEW slot (not reused). So round2 slot0's B side
// will come from whatever match ends up at round1 slot 1. Since slot1 is permanently abandoned, round2 slot0 B will
// simply never fill from that branch — this is expected/acceptable behavior (documented tradeoff: no slot reuse).
console.log("Round2 slot0 currently:", E.findMatch(s, 2, 0));

// --- Scenario 5b: abandoned slot must be revived, not orphaned forever ---
const revivedMatch = E.findMatch(s, 1, 1);
assert(revivedMatch && revivedMatch.status === "ready", "slot 1 should have been revived (not left abandoned), got " + (revivedMatch && revivedMatch.status));
assert(revivedMatch.playerA.name === "Dave" && revivedMatch.playerB.name === "Ivan", "revived slot1 should hold Dave vs Ivan");
E.scorePoint(s, 1, 1, "B", 7);
E.lockMatch(s, 1, 1); // Ivan beats Dave
const round2SlotB = E.findMatch(s, 2, 0);
assert(round2SlotB.playerB && round2SlotB.playerB.name === "Ivan", "round2 slot0 B should now fill via the revived slot1, got " + JSON.stringify(round2SlotB.playerB));
assert(round2SlotB.status === "ready", "round2 slot0 should be ready to play now that both sides are filled");

// --- Scenario 6: bye for a lone waiting player ---
let s2 = E.createDynamicState();
E.addPlayer(s2, "Solo");
let byeRes = E.giveBye(s2, s2.queue[0] ? s2.queue[0].id : null);
assert(byeRes.ok, "bye should succeed for lone queued player: " + JSON.stringify(byeRes));
const soloMatch = s2.matches.find((m) => m.round === 1);
assert(soloMatch.locked && soloMatch.winner === "A", "solo bye match should be auto-locked with Solo winning");
const soloAdvanced = E.findMatch(s2, 2, 0);
assert(soloAdvanced && soloAdvanced.playerA && soloAdvanced.playerA.name === "Solo", "Solo should propagate to round2");

// --- Scenario 7: unlock refuses when downstream already locked ---
// (scorePoint now auto-locks once the deuce/cap outcome is decided, so a
// decisive score is enough — no separate explicit lockMatch call needed.)
let s3 = E.createDynamicState();
["P1", "P2", "P3", "P4"].forEach((n) => E.addPlayer(s3, n));
E.scorePoint(s3, 1, 0, "A", 11); // P1 beats P2, 11-0 (race to 11, decisive)
assert(E.findMatch(s3, 1, 0).locked, "round1 slot0 should auto-lock at 11-0");
E.scorePoint(s3, 1, 1, "A", 11); // P3 beats P4
assert(E.findMatch(s3, 1, 1).locked, "round1 slot1 should auto-lock at 11-0");
E.scorePoint(s3, 2, 0, "A", 21); // P1 beats P3 in the final, 21-0 (decisive)
assert(E.findMatch(s3, 2, 0).locked, "round2 (final) should auto-lock at 21-0");
let unlockAttempt = E.unlockMatch(s3, 1, 0);
assert(unlockAttempt.ok === false, "should refuse to unlock round1 match once round2 already used its result");

// unlock round2 first, then round1 unlock should work
let unlockR2 = E.unlockMatch(s3, 2, 0);
assert(unlockR2.ok, "round2 unlock should succeed: " + JSON.stringify(unlockR2));
let unlockR1now = E.unlockMatch(s3, 1, 0);
assert(unlockR1now.ok, "round1 unlock should now succeed after round2 was unlocked: " + JSON.stringify(unlockR1now));

// --- Scenario 8: preset bracket generation ---
const preset = E.generatePresetBracket(["A", "B", "C", "D", "E", "F", "G"]);
assert(preset.rounds === 3, "7 names should need 3 rounds (bracket of 8), got " + preset.rounds);
const r1 = preset.matches.filter((m) => m.round === 1);
assert(r1.length === 4, "round1 of preset bracket should have 4 matches for size-8 bracket");
const byeCount = r1.filter((m) => m.isByeA || m.isByeB).length;
assert(byeCount === 1, "should be exactly 1 bye match for 7 names in an 8-bracket, got " + byeCount);

// --- Scenario 9: deuce/cap win detection ---
// race to 7, cap 11: normal win by 2 at or above target
let o = E.matchOutcome(7, 5, 7);
assert(o.decided && o.winner === "A", "7-5 should be a decided win for A (2+ lead at target)");
o = E.matchOutcome(7, 6, 7);
assert(!o.decided, "7-6 should NOT be decided yet (only 1 ahead, deuce)");
o = E.matchOutcome(6, 6, 7);
assert(!o.decided, "6-6 should not be decided (tied)");
o = E.matchOutcome(8, 6, 7);
assert(o.decided && o.winner === "A", "8-6 should be a decided deuce win (2 ahead, past target)");
o = E.matchOutcome(11, 10, 7);
assert(!o.decided, "11-10 should NOT be decided yet — cap (11) reached by only one side, still need the other to reach it too... actually rule is min>=cap");
o = E.matchOutcome(10, 10, 7);
assert(!o.decided, "10-10 not decided, still normal deuce (below cap)");
o = E.matchOutcome(11, 11, 7);
assert(!o.decided, "11-11 (both at cap) not decided yet — next point wins");
o = E.matchOutcome(12, 11, 7);
assert(o.decided && o.winner === "A", "12-11 should be decided — sudden death after both hit the cap");
assert(E.capForTarget(7) === 11, "cap for 7 should be 11");
assert(E.capForTarget(11) === 21, "cap for 11 should be 21");
assert(E.capForTarget(21) === 31, "cap for 21 should be 31");

// --- Scenario 10: scorePoint auto-locks once the deuce/cap outcome is decided ---
let s4 = E.createDynamicState();
["Q1", "Q2"].forEach((n) => E.addPlayer(s4, n)); // R=1, single match = the final (race to 21)
E.scorePoint(s4, 1, 0, "A", 21);
let final = E.findMatch(s4, 1, 0);
assert(final.locked && final.winner === "A", "match should auto-lock once 21 is reached with a clear lead");
assert(E.scorePoint(s4, 1, 0, "A", 1).ok === false, "scoring a locked match should be refused");

// deuce path: score to 20-20 then confirm no auto-lock until a real decision
let s5 = E.createDynamicState();
["R1", "R2"].forEach((n) => E.addPlayer(s5, n));
E.scorePoint(s5, 1, 0, "A", 20);
E.scorePoint(s5, 1, 0, "B", 20);
let deuceMatch = E.findMatch(s5, 1, 0);
assert(!deuceMatch.locked, "20-20 in a race-to-21 (cap 31) should still be playing, not locked");
E.scorePoint(s5, 1, 0, "A", 1); // 21-20
assert(!E.findMatch(s5, 1, 0).locked, "21-20 should not lock — only a 1-point lead past target, deuce continues");
E.scorePoint(s5, 1, 0, "A", 1); // 22-20
assert(E.findMatch(s5, 1, 0).locked, "22-20 should lock — 2-point lead past target");

// --- Scenario 11: time-budget-aware early round target ---
// A tiny field (8 players -> R=3) should easily afford race-to-11 early rounds within 90 minutes.
let s6 = E.createDynamicState();
for (let i = 0; i < 8; i++) E.addPlayer(s6, "P" + i);
const smallFieldEarly = E.dynamicRaceToForRound(s6, 1, 90);
assert(smallFieldEarly === 11, "8-player field should afford race-to-11 early rounds in 90 minutes, got " + smallFieldEarly);
// Same field size but a very short event should fall back to 7.
const smallFieldShortTime = E.dynamicRaceToForRound(s6, 1, 15);
assert(smallFieldShortTime === 7, "8-player field with only 15 minutes should fall back to race-to-7, got " + smallFieldShortTime);
// Semifinal/final are always 11/21 regardless of budget.
assert(E.dynamicRaceToForRound(s6, 2, 15) === 11, "semifinal should stay race-to-11 even under a tight budget");
assert(E.dynamicRaceToForRound(s6, 3, 15) === 21, "final should stay race-to-21 even under a tight budget");

// --- Scenario 12: replay-bye (bring back an eliminated player instead of a free bye) ---
let s7 = E.createDynamicState();
["Win1", "Lose1"].forEach((n) => E.addPlayer(s7, n));
E.scorePoint(s7, 1, 0, "A", 7); // Win1 beats Lose1, race to 7 (R=1 here means final actually race-to-21... use explicit score/lock instead)
E.lockMatch(s7, 1, 0);
let elig = E.eligibleForReplay(s7);
assert(elig.length === 1 && elig[0].name === "Lose1", "Lose1 should be eligible for replay after being eliminated, got " + JSON.stringify(elig));
E.addPlayer(s7, "Solo2");
assert(s7.queue.length === 1, "Solo2 should be waiting alone");
let replayRes = E.replayBye(s7, s7.queue[0].id, elig[0].id);
assert(replayRes.ok, "replayBye should succeed: " + JSON.stringify(replayRes));
assert(s7.queue.length === 0, "queue should be empty after replay pairing");
const replayMatch = s7.matches.find((m) => m.round === 1 && m.status !== "abandoned" && m.status !== "locked");
assert(replayMatch && ((replayMatch.playerA && replayMatch.playerA.name === "Solo2") || (replayMatch.playerB && replayMatch.playerB.name === "Solo2")), "Solo2 should be in a fresh match");
assert(replayMatch && ((replayMatch.playerA && replayMatch.playerA.name === "Lose1") || (replayMatch.playerB && replayMatch.playerB.name === "Lose1")), "Lose1 should be paired in as Solo2's opponent");

console.log("\nAll engine tests passed.");
