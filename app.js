(function () {
  "use strict";

  const STORAGE_KEY = "pp_tournaments_v1";

  // ---------------- storage ----------------

  function loadTournaments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Failed to load tournaments", e);
      return [];
    }
  }

  function saveTournaments(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error("Failed to save tournaments", e);
      toast("Couldn't save — your browser's local storage may be full or disabled.");
    }
  }

  let tournaments = loadTournaments();
  let currentTournamentId = null;
  let currentModal = null; // { round, slot }
  let confirmCallback = null;

  function getCurrent() {
    return tournaments.find((t) => t.id === currentTournamentId) || null;
  }

  function persist() {
    saveTournaments(tournaments);
  }

  // ---------------- toast ----------------

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  // ---------------- modal helpers ----------------

  function openModal(id) {
    document.getElementById(id).classList.remove("hidden");
  }
  function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
  }

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close-modal")));
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });

  function confirmAction(title, message, onConfirm) {
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = message;
    confirmCallback = onConfirm;
    openModal("modal-confirm");
  }
  document.getElementById("btn-confirm-action").addEventListener("click", () => {
    const cb = confirmCallback;
    confirmCallback = null;
    closeModal("modal-confirm");
    if (cb) cb();
  });

  // ---------------- routing between screens ----------------

  function showHome() {
    currentTournamentId = null;
    document.getElementById("screen-tournament").classList.add("hidden");
    document.getElementById("screen-home").classList.remove("hidden");
    renderHome();
  }

  function showTournament(id) {
    currentTournamentId = id;
    document.getElementById("screen-home").classList.add("hidden");
    document.getElementById("screen-tournament").classList.remove("hidden");
    renderTournament();
  }

  document.getElementById("btn-back-home").addEventListener("click", showHome);

  // ---------------- home screen ----------------

  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function tournamentQuickStats(t) {
    const R = Engine.computeRounds(t.dynamic);
    const checkedIn = countActivePlayers(t.dynamic);
    if (checkedIn === 0) return "No one checked in yet";
    const champ = findChampion(t.dynamic, R);
    if (champ) return "Champion: " + champ.name;
    return checkedIn + " checked in";
  }

  function countActivePlayers(dynamicState) {
    return Engine.rosterView(dynamicState).length;
  }

  function findChampion(dynamicState, totalRounds) {
    const final = Engine.findMatch(dynamicState, totalRounds, 0);
    if (final && final.locked && final.winner && round1MatchExists(dynamicState)) {
      const w = final.winner === "A" ? final.playerA : final.playerB;
      return w && !Engine.isBye(w) ? w : null;
    }
    return null;
  }
  function round1MatchExists(dynamicState) {
    return dynamicState.matches.some((m) => m.round === 1 && m.status !== "abandoned");
  }

  function renderHome() {
    const container = document.getElementById("tournament-list");
    container.innerHTML = "";
    if (tournaments.length === 0) {
      container.innerHTML = '<p class="empty-home">No tournaments yet. Create one to get started.</p>';
      return;
    }
    const sorted = [...tournaments].sort((a, b) => b.createdAt - a.createdAt);
    sorted.forEach((t) => {
      const card = document.createElement("div");
      card.className = "tournament-card";
      card.innerHTML = `
        <h4>${escapeHtml(t.name)}</h4>
        <div class="meta">Created ${formatDate(t.createdAt)}</div>
        <div class="stats">
          <span>${t.presetNames.length} on interest form</span>
          <span>${escapeHtml(tournamentQuickStats(t))}</span>
        </div>
      `;
      card.addEventListener("click", () => showTournament(t.id));
      container.appendChild(card);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // ---------------- create tournament modal ----------------

  document.getElementById("btn-new-tournament").addEventListener("click", () => {
    document.getElementById("input-tournament-name").value = "";
    document.getElementById("input-preset-names").value = "";
    updatePresetCountHint();
    openModal("modal-create");
    setTimeout(() => document.getElementById("input-tournament-name").focus(), 50);
  });

  function updatePresetCountHint() {
    const names = parseNames(document.getElementById("input-preset-names").value);
    document.getElementById("preset-count-hint").textContent = names.length + " name" + (names.length === 1 ? "" : "s");
  }
  document.getElementById("input-preset-names").addEventListener("input", updatePresetCountHint);

  function parseNames(text) {
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  document.getElementById("btn-create-tournament").addEventListener("click", () => {
    const name = document.getElementById("input-tournament-name").value.trim();
    if (!name) {
      toast("Give the tournament a name first.");
      return;
    }
    const presetNames = parseNames(document.getElementById("input-preset-names").value);
    const eventMinutesRaw = parseInt(document.getElementById("input-event-minutes").value, 10);
    const eventMinutes = Number.isFinite(eventMinutesRaw) && eventMinutesRaw > 0 ? eventMinutesRaw : 90;
    const t = {
      id: Engine.uid("t"),
      name,
      createdAt: Date.now(),
      eventMinutes,
      presetNames,
      presetBracket: presetNames.length >= 2 ? Engine.generatePresetBracket(presetNames) : { rounds: 0, matches: [] },
      dynamic: Engine.createDynamicState(),
    };
    tournaments.push(t);
    persist();
    closeModal("modal-create");
    showTournament(t.id);
  });

  // ---------------- delete tournament ----------------

  document.getElementById("btn-delete-tournament").addEventListener("click", () => {
    const t = getCurrent();
    if (!t) return;
    confirmAction(
      "Delete this tournament?",
      `"${t.name}" and all of its bracket data will be permanently deleted.`,
      () => {
        tournaments = tournaments.filter((x) => x.id !== t.id);
        persist();
        showHome();
      }
    );
  });

  // ---------------- tabs ----------------

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add("active");
    });
  });

  // ---------------- render whole tournament screen ----------------

  function renderTournament() {
    const t = getCurrent();
    if (!t) {
      showHome();
      return;
    }
    document.getElementById("tournament-title").textContent = t.name;
    renderCheckin(t);
    renderDynamicBracket(t);
    renderPresetBracket(t);
  }

  // ---------------- check-in tab ----------------

  document.getElementById("form-checkin").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = getCurrent();
    if (!t) return;
    const input = document.getElementById("input-checkin-name");
    const name = input.value.trim();
    if (!name) return;
    Engine.addPlayer(t.dynamic, name);
    input.value = "";
    persist();
    renderTournament();
    input.focus();
  });

  document.getElementById("btn-give-bye").addEventListener("click", () => {
    const t = getCurrent();
    if (!t || t.dynamic.queue.length !== 1) return;
    const res = Engine.giveBye(t.dynamic, t.dynamic.queue[0].id);
    if (!res.ok) {
      toast(res.reason);
      return;
    }
    persist();
    renderTournament();
  });

  document.getElementById("btn-replay-bye").addEventListener("click", () => {
    const t = getCurrent();
    if (!t || t.dynamic.queue.length !== 1) return;
    const select = document.getElementById("select-replay-player");
    const chosenId = select.value;
    if (!chosenId) return;
    const res = Engine.replayBye(t.dynamic, t.dynamic.queue[0].id, chosenId);
    if (!res.ok) {
      toast(res.reason);
      return;
    }
    persist();
    renderTournament();
    toast("They're back in — match created.");
  });

  const STATUS_LABELS = {
    "waiting-for-opponent": "Waiting",
    "ready-to-play": "Ready",
    "playing": "Playing",
    "advanced": "Advanced",
    "champion": "Champion",
    "eliminated": "Eliminated",
  };

  function renderCheckin(t) {
    const rows = Engine.rosterView(t.dynamic);
    const R = Engine.computeRounds(t.dynamic);
    rows.forEach((r) => {
      if (r.status === "advanced" && r.round === R && round1MatchExists(t.dynamic)) {
        const m = Engine.findMatch(t.dynamic, r.round, r.slot);
        // only the actual final (round === R) match, and R must be the deepest existing round
        if (m && m.round === R) r.status = "champion";
      }
    });

    const list = document.getElementById("roster-list");
    list.innerHTML = "";
    if (rows.length === 0) {
      list.innerHTML = '<p class="empty-roster">No one has checked in yet.</p>';
    } else {
      rows.forEach((r) => {
        const row = document.createElement("div");
        row.className = "roster-row";
        const label = STATUS_LABELS[r.status] || r.status;
        row.innerHTML = `
          <span class="rname">${escapeHtml(r.name)}</span>
          <span class="rmeta">
            <span class="status-pill status-${r.status}">${label}</span>
            <button class="remove-btn" title="${r.removable ? "Remove player" : "Already played — can't remove"}" ${r.removable ? "" : "disabled"} aria-label="Remove">✕</button>
          </span>
        `;
        row.querySelector(".remove-btn").addEventListener("click", () => {
          if (!r.removable) return;
          confirmAction("Remove player?", `Remove ${r.name} from the tournament?`, () => {
            const res = Engine.removePlayer(t.dynamic, r.id);
            if (!res.ok) {
              toast(res.reason);
              return;
            }
            persist();
            renderTournament();
          });
        });
        list.appendChild(row);
      });
    }

    document.getElementById("checkin-count-hint").textContent = rows.length + " checked in";

    const byeBanner = document.getElementById("bye-banner");
    const replayRow = document.getElementById("replay-row");
    if (t.dynamic.queue.length === 1) {
      byeBanner.classList.remove("hidden");
      document.getElementById("bye-banner-text").textContent = `${t.dynamic.queue[0].name} is waiting alone for an opponent.`;
      const candidates = Engine.eligibleForReplay(t.dynamic);
      if (candidates.length > 0) {
        replayRow.classList.remove("hidden");
        const select = document.getElementById("select-replay-player");
        select.innerHTML = candidates.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
      } else {
        replayRow.classList.add("hidden");
      }
    } else {
      byeBanner.classList.add("hidden");
      replayRow.classList.add("hidden");
    }
  }

  // ---------------- dynamic bracket tab ----------------

  function renderDynamicBracket(t) {
    const container = document.getElementById("dynamic-bracket");
    const emptyState = document.getElementById("dynamic-bracket-empty");
    container.innerHTML = "";

    if (!round1MatchExists(t.dynamic) && t.dynamic.queue.length === 0) {
      emptyState.classList.remove("hidden");
      container.classList.add("hidden");
      return;
    }
    emptyState.classList.add("hidden");
    container.classList.remove("hidden");

    const R = Engine.computeRounds(t.dynamic);

    for (let round = 1; round <= R; round++) {
      const slotsInRound = Math.pow(2, R - round);
      const raceTo = Engine.dynamicRaceToForRound(t.dynamic, round, t.eventMinutes);
      const roundCol = document.createElement("div");
      roundCol.className = "bracket-round";
      const title = round === R ? "Final" : round === R - 1 ? "Semifinal" : `Round ${round}`;
      roundCol.innerHTML = `<div class="round-header">${title} · Race to ${raceTo}</div>`;
      const matchesWrap = document.createElement("div");
      matchesWrap.className = "round-matches";

      for (let slot = 0; slot < slotsInRound; slot++) {
        const m = Engine.findMatch(t.dynamic, round, slot);
        matchesWrap.appendChild(renderMatchCard(m, round, slot, t));
      }
      roundCol.appendChild(matchesWrap);
      container.appendChild(roundCol);
    }
  }

  function playerLabel(p) {
    if (!p) return "TBD";
    if (Engine.isBye(p)) return "BYE";
    return p.name;
  }

  function renderMatchCard(m, round, slot, t) {
    const card = document.createElement("div");
    const hasMatch = !!m && m.status !== "abandoned";
    const playerA = hasMatch ? m.playerA : null;
    const playerB = hasMatch ? m.playerB : null;
    const bothPresent = playerA && playerB;
    const clickable = hasMatch && bothPresent;

    let stateClass = "not-ready";
    if (hasMatch) {
      if (m.locked) stateClass = "locked";
      else if (m.status === "in-progress") stateClass = "in-progress";
      else if (bothPresent) stateClass = "ready";
      else stateClass = "not-ready";
    }
    card.className = `match-card ${stateClass}`;
    card.setAttribute("data-round", round);
    card.setAttribute("data-slot", slot);

    const aWin = hasMatch && m.locked && m.winner === "A";
    const bWin = hasMatch && m.locked && m.winner === "B";

    const raceTo = hasMatch
      ? Engine.dynamicDisplayRaceTo(m, t.dynamic, t.eventMinutes)
      : Engine.dynamicRaceToForRound(t.dynamic, round, t.eventMinutes);
    const scoreA = hasMatch && (m.status === "in-progress" || m.locked) ? m.scoreA : null;
    const scoreB = hasMatch && (m.status === "in-progress" || m.locked) ? m.scoreB : null;

    card.innerHTML = `
      <div class="match-row ${aWin ? "winner" : bWin ? "loser" : ""}">
        <span class="pname">${playerLabel(playerA)}</span>
        <span class="pscore">${scoreA != null ? scoreA : ""}</span>
      </div>
      <div class="match-row ${bWin ? "winner" : aWin ? "loser" : ""}">
        <span class="pname">${playerLabel(playerB)}</span>
        <span class="pscore">${scoreB != null ? scoreB : ""}</span>
      </div>
      <div class="match-meta">${hasMatch && m.locked ? "Final" : "Race to " + raceTo}</div>
    `;

    if (clickable) {
      card.addEventListener("click", () => openScoreModal(round, slot));
    }
    return card;
  }

  // ---------------- preset bracket tab (static, view-only) ----------------

  function renderPresetBracket(t) {
    const container = document.getElementById("preset-bracket");
    container.innerHTML = "";
    const preset = t.presetBracket;
    if (!preset || preset.rounds === 0) {
      container.innerHTML = '<p class="empty-home">Add at least 2 names to the interest-form list to generate a reference bracket.</p>';
      return;
    }
    for (let round = 1; round <= preset.rounds; round++) {
      const roundCol = document.createElement("div");
      roundCol.className = "bracket-round";
      const title = round === preset.rounds ? "Final" : round === preset.rounds - 1 ? "Semifinal" : `Round ${round}`;
      const raceTo = Engine.raceToForRound(round, preset.rounds);
      roundCol.innerHTML = `<div class="round-header">${title} · Race to ${raceTo}</div>`;
      const matchesWrap = document.createElement("div");
      matchesWrap.className = "round-matches";
      preset.matches
        .filter((m) => m.round === round)
        .sort((a, b) => a.slot - b.slot)
        .forEach((m) => {
          const card = document.createElement("div");
          card.className = round === 1 ? "match-card preset-filled" : "match-card not-ready";
          const aLabel = round === 1 ? (m.isByeA ? '<span class="bye-tag">BYE</span>' : escapeHtml(m.playerA || "TBD")) : "TBD";
          const bLabel = round === 1 ? (m.isByeB ? '<span class="bye-tag">BYE</span>' : escapeHtml(m.playerB || "TBD")) : "TBD";
          card.innerHTML = `
            <div class="match-row"><span class="pname">${aLabel}</span></div>
            <div class="match-row"><span class="pname">${bLabel}</span></div>
          `;
          matchesWrap.appendChild(card);
        });
      roundCol.appendChild(matchesWrap);
      container.appendChild(roundCol);
    }
  }

  // ---------------- scoring modal ----------------

  function openScoreModal(round, slot) {
    currentModal = { round, slot };
    renderScoreModal();
    openModal("modal-score");
  }

  function renderScoreModal() {
    const t = getCurrent();
    if (!t || !currentModal) return;
    const { round, slot } = currentModal;
    const m = Engine.findMatch(t.dynamic, round, slot);
    if (!m) {
      closeModal("modal-score");
      return;
    }
    const R = Engine.computeRounds(t.dynamic);
    const raceTo = Engine.dynamicDisplayRaceTo(m, t.dynamic, t.eventMinutes);
    const title = round === R ? "Final" : round === R - 1 ? "Semifinal" : `Round ${round}`;
    document.getElementById("score-round-label").textContent = `${title} · Race to ${raceTo}`;
    const cap = Engine.capForTarget(raceTo);
    document.getElementById("score-deuce-hint").textContent =
      `Win by 2 once you hit ${raceTo}. Deadlocked at ${cap}-${cap}? Next point wins.`;

    const infoView = document.getElementById("score-info-view");
    const playView = document.getElementById("score-play-view");
    const footer = document.querySelector(".score-footer");
    const badge = document.getElementById("score-status-badge");

    const isSpecial = m.locked && (Engine.isBye(m.playerA) || Engine.isBye(m.playerB) || m.forfeit);

    if (isSpecial) {
      infoView.classList.remove("hidden");
      playView.classList.add("hidden");
      footer.classList.add("hidden");
      document.getElementById("score-deuce-hint").classList.add("hidden");
      const winner = m.winner === "A" ? m.playerA : m.playerB;
      const reason = m.forfeit && !Engine.isBye(m.playerA) && !Engine.isBye(m.playerB)
        ? "the opponent left before this match was played"
        : "a bye";
      document.getElementById("score-info-text").textContent =
        `${winner.name} advances automatically — ${reason}.`;
      badge.classList.remove("hidden");
      badge.textContent = "Locked";
      return;
    }

    infoView.classList.add("hidden");
    playView.classList.remove("hidden");
    footer.classList.remove("hidden");
    document.getElementById("score-deuce-hint").classList.remove("hidden");

    document.getElementById("name-a").textContent = playerLabel(m.playerA);
    document.getElementById("name-b").textContent = playerLabel(m.playerB);
    document.getElementById("value-a").textContent = m.scoreA;
    document.getElementById("value-b").textContent = m.scoreB;

    const sideA = document.getElementById("side-a");
    const sideB = document.getElementById("side-b");
    sideA.classList.toggle("win", m.locked && m.winner === "A");
    sideB.classList.toggle("win", m.locked && m.winner === "B");

    document.querySelectorAll(".score-btn").forEach((btn) => {
      btn.disabled = m.locked;
    });

    if (m.locked) {
      badge.classList.remove("hidden");
      badge.textContent = "Locked";
    } else {
      badge.classList.add("hidden");
    }

    const lockBtn = document.getElementById("btn-lock-toggle");
    const lockHint = document.getElementById("lock-hint");
    const tied = m.scoreA === m.scoreB;
    if (m.locked) {
      lockBtn.textContent = "Unlock game";
      lockBtn.className = "btn btn-secondary";
      lockBtn.disabled = false;
      lockHint.classList.add("hidden");
    } else {
      lockBtn.textContent = "Lock game";
      lockBtn.className = "btn btn-primary";
      lockBtn.disabled = tied;
      lockHint.classList.toggle("hidden", !tied);
    }
  }

  document.querySelectorAll(".score-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = getCurrent();
      if (!t || !currentModal) return;
      const { round, slot } = currentModal;
      const res = Engine.scorePoint(t.dynamic, round, slot, btn.dataset.side, parseInt(btn.dataset.delta, 10), t.eventMinutes);
      if (!res.ok) {
        toast(res.reason);
        return;
      }
      persist();
      renderScoreModal();
      renderDynamicBracket(t);
      renderCheckin(t);
      if (res.autoLocked) {
        toast(`${res.winnerName} wins! Match locked automatically.`);
      }
    });
  });

  document.getElementById("btn-lock-toggle").addEventListener("click", () => {
    const t = getCurrent();
    if (!t || !currentModal) return;
    const { round, slot } = currentModal;
    const m = Engine.findMatch(t.dynamic, round, slot);
    if (!m) return;
    const res = m.locked ? Engine.unlockMatch(t.dynamic, round, slot) : Engine.lockMatch(t.dynamic, round, slot);
    if (!res.ok) {
      toast(res.reason);
      return;
    }
    persist();
    renderScoreModal();
    renderDynamicBracket(t);
    renderCheckin(t);
  });

  // ---------------- init ----------------

  showHome();
})();
