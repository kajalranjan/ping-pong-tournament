// engine.js — pure bracket logic, no DOM. Works in Node (for tests) and in the browser.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Engine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BYE_ID = "__BYE__";
  const BYE_MARKER = Object.freeze({ id: BYE_ID, name: "BYE" });

  function isBye(p) {
    return !!p && p.id === BYE_ID;
  }

  function uid(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 9)
    );
  }

  // ---------- construction ----------

  function createDynamicState() {
    return {
      queue: [], // players waiting to be paired into a round-1 match
      matches: [], // flat list of match objects
      round1SlotCounter: 0,
    };
  }

  function newMatch(round, slot) {
    return {
      round,
      slot,
      playerA: null,
      playerB: null,
      scoreA: 0,
      scoreB: 0,
      locked: false,
      winner: null, // 'A' | 'B' | null
      forfeit: false,
      status: "waiting", // waiting | ready | in-progress | locked | abandoned
      frozenRaceTo: null,
    };
  }

  function findMatch(state, round, slot) {
    return state.matches.find((m) => m.round === round && m.slot === slot) || null;
  }

  function getOrCreateMatch(state, round, slot) {
    let m = findMatch(state, round, slot);
    if (!m) {
      m = newMatch(round, slot);
      state.matches.push(m);
    }
    return m;
  }

  // ---------- round depth / race-to scaling ----------

  function round1MatchCount(state) {
    return state.matches.filter((m) => m.round === 1 && m.status !== "abandoned").length;
  }

  function computeRounds(state) {
    const n = Math.max(2, round1MatchCount(state) * 2);
    return Math.max(1, Math.ceil(Math.log2(n)));
  }

  function raceToForRound(round, totalRounds) {
    const distanceFromFinal = totalRounds - round + 1;
    if (distanceFromFinal <= 1) return 21; // final
    if (distanceFromFinal === 2) return 11; // semifinal
    return 7; // everything earlier
  }

  function displayRaceTo(match, totalRounds) {
    if (match.frozenRaceTo != null) return match.frozenRaceTo;
    return raceToForRound(match.round, totalRounds);
  }

  // ---------- round-1 pairing from the queue ----------

  function tryFormMatches(state) {
    while (state.queue.length >= 2) {
      const a = state.queue.shift();
      const b = state.queue.shift();
      // Prefer reviving the lowest-numbered abandoned round-1 slot over minting a new
      // one, so a bracket position freed by a removal doesn't stay unfillable forever.
      const revived = state.matches
        .filter((m) => m.round === 1 && m.status === "abandoned")
        .sort((x, y) => x.slot - y.slot)[0];
      let m;
      if (revived) {
        m = revived;
        m.locked = false;
        m.winner = null;
        m.forfeit = false;
        m.frozenRaceTo = null;
      } else {
        const slot = state.round1SlotCounter++;
        m = newMatch(1, slot);
        state.matches.push(m);
      }
      m.playerA = a;
      m.playerB = b;
      m.scoreA = 0;
      m.scoreB = 0;
      m.status = "ready";
    }
  }

  function addPlayer(state, name) {
    const player = { id: uid("p"), name: String(name).trim(), checkedInAt: Date.now() };
    state.queue.push(player);
    tryFormMatches(state);
    return player;
  }

  function giveBye(state, playerId) {
    const idx = state.queue.findIndex((p) => p.id === playerId);
    if (idx === -1 || state.queue.length !== 1) {
      return { ok: false, reason: "Bye is only available to a single player currently waiting alone." };
    }
    const player = state.queue.splice(idx, 1)[0];
    const slot = state.round1SlotCounter++;
    const m = newMatch(1, slot);
    m.playerA = player;
    m.playerB = BYE_MARKER;
    m.scoreA = 0;
    m.scoreB = 0;
    m.locked = true;
    m.winner = "A";
    m.forfeit = true;
    m.status = "locked";
    m.frozenRaceTo = 0;
    state.matches.push(m);
    propagateWinner(state, m);
    return { ok: true };
  }

  // ---------- locking / propagation ----------

  function winnerPlayer(m) {
    if (!m.locked || !m.winner) return null;
    return m.winner === "A" ? m.playerA : m.playerB;
  }
  function loserPlayer(m) {
    if (!m.locked || !m.winner) return null;
    return m.winner === "A" ? m.playerB : m.playerA;
  }

  function propagateWinner(state, m) {
    const winner = winnerPlayer(m);
    if (!winner) return;
    const targetRound = m.round + 1;
    const targetSlot = Math.floor(m.slot / 2);
    const position = m.slot % 2 === 0 ? "A" : "B";
    const target = getOrCreateMatch(state, targetRound, targetSlot);
    if (position === "A") target.playerA = winner;
    else target.playerB = winner;
    if (target.playerA && target.playerB) target.status = "ready";
    else target.status = "waiting";
  }

  function lockMatch(state, round, slot) {
    const m = findMatch(state, round, slot);
    if (!m) return { ok: false, reason: "Match not found." };
    if (m.locked) return { ok: false, reason: "Match is already locked." };
    if (!m.playerA || !m.playerB) return { ok: false, reason: "Both players are not set yet." };
    if (m.scoreA === m.scoreB) return { ok: false, reason: "Scores are tied — break the tie before locking." };
    m.locked = true;
    m.winner = m.scoreA > m.scoreB ? "A" : "B";
    m.status = "locked";
    propagateWinner(state, m);
    return { ok: true };
  }

  // Retract a match's result. Refuses if a downstream match already locked using this result.
  function unlockMatch(state, round, slot) {
    const m = findMatch(state, round, slot);
    if (!m) return { ok: false, reason: "Match not found." };
    if (!m.locked) return { ok: false, reason: "Match is not locked." };

    const targetRound = m.round + 1;
    const targetSlot = Math.floor(m.slot / 2);
    const target = findMatch(state, targetRound, targetSlot);
    if (target && target.locked) {
      return {
        ok: false,
        reason: "A later match already used this result. Unlock that match first.",
      };
    }

    if (target) {
      const position = m.slot % 2 === 0 ? "A" : "B";
      if (position === "A") target.playerA = null;
      else target.playerB = null;
      target.scoreA = 0;
      target.scoreB = 0;
      target.frozenRaceTo = null;
      target.status = target.playerA && target.playerB ? "ready" : "waiting";
      if (!target.playerA && !target.playerB && target.round > 1) {
        // fully empty downstream placeholder — leave it, it'll refill
      }
    }

    m.locked = false;
    m.winner = null;
    m.status = m.scoreA === 0 && m.scoreB === 0 ? "ready" : "in-progress";
    if (m.forfeit) {
      // Can't "un-forfeit" a bye cleanly; treat as a normal reopened match.
      m.forfeit = false;
    }
    return { ok: true };
  }

  // ---------- scoring ----------

  function scorePoint(state, round, slot, side, delta) {
    const m = findMatch(state, round, slot);
    if (!m) return { ok: false, reason: "Match not found." };
    if (m.locked) return { ok: false, reason: "Match is locked — unlock it first." };
    if (!m.playerA || !m.playerB) return { ok: false, reason: "Both players are not set yet." };
    const key = side === "A" ? "scoreA" : "scoreB";
    m[key] = Math.max(0, m[key] + delta);
    if (m.frozenRaceTo == null && (m.scoreA > 0 || m.scoreB > 0)) {
      m.frozenRaceTo = raceToForRound(m.round, computeRounds(state));
    }
    m.status = m.scoreA === 0 && m.scoreB === 0 ? "ready" : "in-progress";
    return { ok: true };
  }

  // ---------- removal ----------

  function playerStatus(state, playerId) {
    if (state.queue.some((p) => p.id === playerId)) return { location: "queue" };
    for (const m of state.matches) {
      if (m.playerA && m.playerA.id === playerId) return { location: "match", match: m, side: "A" };
      if (m.playerB && m.playerB.id === playerId) return { location: "match", match: m, side: "B" };
    }
    return { location: "none" };
  }

  function removePlayer(state, playerId) {
    const st = playerStatus(state, playerId);
    if (st.location === "queue") {
      state.queue = state.queue.filter((p) => p.id !== playerId);
      return { ok: true };
    }
    if (st.location === "none") {
      return { ok: false, reason: "Player not found." };
    }

    const m = st.match;
    if (m.locked) {
      return { ok: false, reason: "This player's most recent match is already locked — unlock it first if you need to change it." };
    }

    const removedSide = st.side;
    const otherSide = removedSide === "A" ? "B" : "A";
    const otherPlayer = m[otherSide === "A" ? "playerA" : "playerB"];

    if (m.round === 1) {
      // Round 1: clear this match, survivor (if any) goes back to the front of the queue.
      m.playerA = null;
      m.playerB = null;
      m.scoreA = 0;
      m.scoreB = 0;
      m.frozenRaceTo = null;
      m.status = "abandoned";
      if (otherPlayer && !isBye(otherPlayer)) {
        state.queue.unshift(otherPlayer);
      }
      tryFormMatches(state);
      return { ok: true };
    }

    // Round >= 2
    if (removedSide === "A") m.playerA = null;
    else m.playerB = null;
    m.scoreA = 0;
    m.scoreB = 0;
    m.frozenRaceTo = null;

    if (otherPlayer && !isBye(otherPlayer)) {
      // Walkover: the remaining player auto-advances.
      m.locked = true;
      m.winner = otherSide;
      m.forfeit = true;
      m.status = "locked";
      propagateWinner(state, m);
    } else {
      m.status = "waiting";
    }
    return { ok: true };
  }

  // ---------- roster / status summary for the check-in tab ----------

  function rosterView(state) {
    const rows = [];
    const seen = new Set();

    state.queue.forEach((p) => {
      rows.push({ id: p.id, name: p.name, checkedInAt: p.checkedInAt, status: "waiting-for-opponent", removable: true });
      seen.add(p.id);
    });

    state.matches.forEach((m) => {
      [
        ["playerA", "A"],
        ["playerB", "B"],
      ].forEach(([key, side]) => {
        const p = m[key];
        if (!p || isBye(p) || seen.has(p.id)) return;
        seen.add(p.id);
        let status;
        if (m.status === "abandoned") return; // player already removed / not represented here
        if (m.locked) {
          status = m.winner === side ? "advanced" : "eliminated";
          if (m.winner === side) {
            // if this is the final round, mark champion later in caller (needs totalRounds)
          }
        } else if (m.status === "ready") {
          status = "ready-to-play";
        } else if (m.status === "in-progress") {
          status = "playing";
        } else {
          status = "waiting-for-opponent";
        }
        rows.push({
          id: p.id,
          name: p.name,
          checkedInAt: p.checkedInAt,
          status,
          removable: !m.locked,
          round: m.round,
          slot: m.slot,
        });
      });
    });

    rows.sort((a, b) => (a.checkedInAt || 0) - (b.checkedInAt || 0));
    return rows;
  }

  // ---------- preset (static) bracket ----------

  function seedOrder(size) {
    let positions = [1];
    while (positions.length < size) {
      const newSize = positions.length * 2;
      const next = [];
      positions.forEach((p) => {
        next.push(p);
        next.push(newSize + 1 - p);
      });
      positions = next;
    }
    return positions;
  }

  function generatePresetBracket(names) {
    const n = names.length;
    if (n < 2) return { rounds: 0, matches: [] };
    const rounds = Math.ceil(Math.log2(n));
    const size = Math.pow(2, rounds);
    const order = seedOrder(size); // seed numbers 1..size in slot order
    const seedToName = (seed) => (seed <= n ? names[seed - 1] : null); // null = bye

    const matches = [];
    // round 1
    for (let i = 0; i < size / 2; i++) {
      const seedA = order[i * 2];
      const seedB = order[i * 2 + 1];
      const nameA = seedToName(seedA);
      const nameB = seedToName(seedB);
      matches.push({
        round: 1,
        slot: i,
        playerA: nameA,
        playerB: nameB,
        isByeA: nameA == null,
        isByeB: nameB == null,
      });
    }
    // placeholder rounds 2..rounds (names TBD — this is a static reference, not simulated)
    let matchesInRound = size / 4;
    for (let r = 2; r <= rounds; r++) {
      for (let i = 0; i < matchesInRound; i++) {
        matches.push({ round: r, slot: i, playerA: null, playerB: null, isByeA: false, isByeB: false });
      }
      matchesInRound = Math.max(1, Math.floor(matchesInRound / 2));
      if (matchesInRound === 0) matchesInRound = 1;
    }
    // Note: intentionally plain data only (rounds, matches) — this object gets
    // JSON-serialized to localStorage, so no function properties belong here.
    // Use Engine.raceToForRound(round, preset.rounds) when rendering instead.
    return { rounds, matches };
  }

  return {
    BYE_MARKER,
    isBye,
    uid,
    createDynamicState,
    addPlayer,
    removePlayer,
    giveBye,
    scorePoint,
    lockMatch,
    unlockMatch,
    computeRounds,
    raceToForRound,
    displayRaceTo,
    findMatch,
    rosterView,
    generatePresetBracket,
    seedOrder,
  };
});
