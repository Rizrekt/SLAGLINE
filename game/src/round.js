// SLAGLINE — round: the only owner of match state. State machine
// FREEZE/BUY (12 s) -> LIVE (100 s) -> PLANTED (charge 35 s) -> END
// (5 s pause), first to 9, at most 16 rounds; 8-8 after 16 goes to total
// kills. One instance per match; the round drives the bomb, pays the
// economy, picks the carrier, and decides when the match is over.
// All numbers come from CONFIG.
//
// Interfaces this file expects (owned by other lines):
//   actors: createActor results — team, alive, money, kills, deaths,
//     reset(roundNumber), takeDamage handled elsewhere; the player actor
//     is passed in options.player so a Striker player is carrier by
//     default (PREP section 6).
//   options: { rng (createRng, seeded), player, hooks } where hooks is
//     { onRoundStart(round), onPhase(phase, round),
//       onRoundEnd(round, reason, winner), onMatchEnd(round, winner),
//       onKill(victim, killer) } — main.js wires HUD/audio to these.
import { CONFIG } from './config.js';
import { Economy } from './economy.js';
import { Bomb } from './bomb.js';

const PHASE_FREEZE = 'FREEZE';
const PHASE_LIVE = 'LIVE';
const PHASE_PLANTED = 'PLANTED';
const PHASE_END = 'END';

export function createRound(actors, options = {}) {
  const rng = options.rng || null;
  const player = options.player || null;
  const hooks = options.hooks || {};
  const R = CONFIG.round;

  const round = {
    phase: PHASE_FREEZE,
    roundNumber: 0,
    score: { Strikers: 0, Sentinels: 0 },
    totalKills: { Strikers: 0, Sentinels: 0 },
    timer: R.freezeBuySeconds,
    liveElapsed: 0,
    matchOver: false,
    matchWinner: null,
    roundWinner: null,
    roundEndReason: null,
    lossStreak: { Strikers: 0, Sentinels: 0 },
    carrier: null,
    targetSite: null,
    plantedThisRound: false,
    lastTargetSites: [],
  };

  // Economy may only sell while this round says the buy window is open:
  Economy.bindContext({
    canBuy() {
      if (round.phase === PHASE_FREEZE) return true;
      if (round.phase === PHASE_LIVE && round.liveElapsed <= R.buyGraceSeconds) return true;
      return false;
    },
    getRoundNumber() {
      return round.roundNumber;
    },
  });

  // The bomb reports back into the round: a plant switches the phase,
  Bomb.init({
    getPhase() {
      return round.phase;
    },
    sites: options.sites || [],
    actors,
    hooks: {
      onPlanted(site, planter) {
        round.plantedThisRound = true;
        round.phase = PHASE_PLANTED;
        round.timer = R.chargeSeconds;
        const team = actors.filter((a) => a && a.team === 'Strikers');
        Economy.awardPlant(planter, team);
        if (hooks.onPhase) hooks.onPhase(round.phase, snapshot());
      },
      onDetonated() {
        if (round.phase === PHASE_PLANTED) round.endRound('charge', 'Strikers');
      },
      onDefused(defuser) {
        Economy.awardDefuse(defuser);
        if (round.phase === PHASE_PLANTED) round.endRound('defuse', 'Sentinels');
      },
      onPlantCancelled(actor) {
        if (hooks.onPlantCancelled) hooks.onPlantCancelled(actor, snapshot());
      },
      onDefuseCancelled(actor) {
        if (hooks.onDefuseCancelled) hooks.onDefuseCancelled(actor, snapshot());
      },
      onPickup(actor) {
        round.carrier = actor;
        if (hooks.onPickup) hooks.onPickup(actor, snapshot());
      },
      onBeep(timeLeft) {
        if (hooks.onBeep) hooks.onBeep(timeLeft, snapshot());
      },
    },
  });

  function snapshot() {
    return {
      phase: round.phase,
      roundNumber: round.roundNumber,
      score: { ...round.score },
      totalKills: { ...round.totalKills },
      timer: round.timer,
      matchOver: round.matchOver,
      matchWinner: round.matchWinner,
      roundWinner: round.roundWinner,
      roundEndReason: round.roundEndReason,
      carrier: round.carrier,
      targetSite: round.targetSite,
      plantedThisRound: round.plantedThisRound,
    };
  }

  function pickCarrier() {
    const strikers = actors.filter((a) => a && a.team === 'Strikers' && a.alive);
    if (strikers.length === 0) return null;
    // The player carries the objective when they play Strikers: the
    if (player && player.team === 'Strikers' && strikers.includes(player)) return player;
    if (rng) return rng.pick(strikers);
    return strikers[0];
  }

  function pickTargetSite() {
    const sites = ['A', 'B'];
    if (!rng) return sites[round.roundNumber % 2];
    // Never three rounds in a row to the same site: cheap unpredictability.
    const last = round.lastTargetSites;
    if (last.length >= 2 && last[last.length - 1] === last[last.length - 2]) {
      const other = last[last.length - 1] === 'A' ? 'B' : 'A';
      round.lastTargetSites.push(other);
      return other;
    }
    const site = rng.pick(sites);
    round.lastTargetSites.push(site);
    return site;
  }

  // Live site list (map.js owns it). main.js calls this once the map is
  round.setSites = function setSites(sites) {
    options.sites = sites || [];
    Bomb.init({ sites: options.sites });
  };

  round.startMatch = function startMatch() {
    round.roundNumber = 0;
    round.score = { Strikers: 0, Sentinels: 0 };
    round.totalKills = { Strikers: 0, Sentinels: 0 };
    round.matchOver = false;
    round.matchWinner = null;
    round.lossStreak = { Strikers: 0, Sentinels: 0 };
    round.lastTargetSites = [];
    for (const actor of actors) {
      if (actor) actor.money = CONFIG.economy.startMoney;
    }
    round.startRound();
  };

  round.startRound = function startRound() {
    round.roundNumber += 1;
    round.roundWinner = null;
    round.roundEndReason = null;
    round.plantedThisRound = false;
    round.liveElapsed = 0;
    for (const actor of actors) {
      if (actor && actor.reset) actor.reset(round.roundNumber);
    }
    round.carrier = pickCarrier();
    round.targetSite = pickTargetSite();
    Bomb.resetRound(round.carrier);
    // Bomb needs the live site list every round (map.js owns it).
    Bomb.init({ sites: options.sites || [] });
    round.phase = PHASE_FREEZE;
    round.timer = R.freezeBuySeconds;
    if (hooks.onRoundStart) hooks.onRoundStart(snapshot());
    if (hooks.onPhase) hooks.onPhase(round.phase, snapshot());
  };

  round.onKill = function onKill(victim, killer) {
    if (!victim || round.matchOver) return;
    // Kills only count while the round is live (or the charge is ticking).
    if (round.phase !== PHASE_LIVE && round.phase !== PHASE_PLANTED) return;
    if (killer && killer.team && killer.team !== victim.team) {
      round.totalKills[killer.team] += 1;
      const weaponId = killer.weapons ? killer.weapons.currentId : null;
      Economy.awardKill(killer, weaponId);
    }
    Bomb.onCarrierDeath(victim);
    if (hooks.onKill) hooks.onKill(victim, killer, snapshot());
    const strikersAlive = actors.some((a) => a && a.team === 'Strikers' && a.alive);
    const sentinelsAlive = actors.some((a) => a && a.team === 'Sentinels' && a.alive);
    if (!strikersAlive && !sentinelsAlive) {
      // Mutual wipe with no charge planted: the round is a draw in kills,
      if (round.phase === PHASE_PLANTED) return;
      round.endRound('time', 'Sentinels');
      return;
    }
    if (!sentinelsAlive) {
      round.endRound('elimination', 'Strikers');
      return;
    }
    if (!strikersAlive) {
      // Charge planted: the round is not over when the attackers die —
      if (round.phase === PHASE_PLANTED) return;
      round.endRound('elimination', 'Sentinels');
    }
  };

  round.endRound = function endRound(reason, winnerTeam) {
    if (round.phase === PHASE_END || round.matchOver) return;
    round.roundWinner = winnerTeam;
    round.roundEndReason = reason;
    round.score[winnerTeam] += 1;
    const loserTeam = winnerTeam === 'Strikers' ? 'Sentinels' : 'Strikers';
    round.lossStreak[winnerTeam] = 0;
    round.lossStreak[loserTeam] += 1;
    Economy.awardRound(winnerTeam, reason, actors, round.lossStreak);
    round.phase = PHASE_END;
    round.timer = R.endPauseSeconds;
    if (hooks.onRoundEnd) hooks.onRoundEnd(snapshot(), reason, winnerTeam);
    if (hooks.onPhase) hooks.onPhase(round.phase, snapshot());
  };

  function finishMatchIfDecided() {
    const firstTo = R.firstTo;
    const maxRounds = R.maxRounds;
    let winner = null;
    if (round.score.Strikers >= firstTo) winner = 'Strikers';
    else if (round.score.Sentinels >= firstTo) winner = 'Sentinels';
    else if (round.roundNumber >= maxRounds) {
      if (round.score.Strikers !== round.score.Sentinels) {
        winner = round.score.Strikers > round.score.Sentinels ? 'Strikers' : 'Sentinels';
      } else if (round.totalKills.Strikers !== round.totalKills.Sentinels) {
        // 8-8 after 16 rounds: the team with more total kills takes it.
        winner = round.totalKills.Strikers > round.totalKills.Sentinels ? 'Strikers' : 'Sentinels';
      } else {
        winner = 'Draw';
      }
    }
    if (winner) {
      round.matchOver = true;
      round.matchWinner = winner;
      if (hooks.onMatchEnd) hooks.onMatchEnd(snapshot(), winner);
      return true;
    }
    return false;
  }

  // Fixed-step tick: phase timers and the bomb run on sim time.
  round.step = function step(dt) {
    if (round.matchOver) return;
    round.timer -= dt;
    if (round.phase === PHASE_FREEZE) {
      if (round.timer <= 0) {
        round.phase = PHASE_LIVE;
        round.timer = R.liveSeconds;
        round.liveElapsed = 0;
        if (hooks.onPhase) hooks.onPhase(round.phase, snapshot());
      }
      return;
    }
    if (round.phase === PHASE_LIVE) {
      round.liveElapsed += dt;
      Bomb.step(dt);
      if (round.phase !== PHASE_LIVE) return;
      if (round.timer <= 0) {
        // Clock ran out with no plant: the defenders hold the sites.
        round.endRound('time', 'Sentinels');
      }
      return;
    }
    if (round.phase === PHASE_PLANTED) {
      Bomb.step(dt);
      round.timer = Bomb.state.planted ? Bomb.state.timeLeft : round.timer;
      return;
    }
    if (round.phase === PHASE_END) {
      if (round.timer <= 0) {
        if (!finishMatchIfDecided()) round.startRound();
      }
    }
  };

  return round;
}
