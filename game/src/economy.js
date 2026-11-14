// SLAGLINE — economy: one wallet per actor, buy rules, round rewards.
// All prices and rewards come from CONFIG. This module never decides
// match state — it only moves money, and only when the round says buying
// or paying is legal. Friendly fire is off, so there is no team-kill fine.
//
// Interfaces this file expects (owned by other lines):
//   actor: money, team, alive, weapons (createWeaponSet: add/has/switchTo),
//     grenades (count), armor (bool), helmet (bool), hasDefuseKit (bool),
//     role (bot role string, e.g. 'mid' — optional, defaults to 'flex').
//   context bound by round.js: canBuy() — true during FREEZE/BUY and the
//     first 3 seconds of LIVE (buy grace); getRoundNumber() for logs.
import { CONFIG } from './config.js';

let context = {
  canBuy: () => false,
  getRoundNumber: () => 0,
};

function clampMoney(actor) {
  if (actor.money > CONFIG.economy.moneyCap) actor.money = CONFIG.economy.moneyCap;
  if (actor.money < 0) actor.money = 0;
}

function pay(actor, amount) {
  actor.money += amount;
  clampMoney(actor);
}

export const Economy = {
  bindContext(boundContext) {
    context = { ...context, ...boundContext };
  },

  // Buy one item. Returns true only when every gate passes: buy window
  tryBuy(actor, itemId) {
    if (!actor || !actor.alive) return false;
    if (!context.canBuy()) return false;
    const weaponDef = CONFIG.weapons[itemId];
    const itemDef = CONFIG.items[itemId];
    if (!weaponDef && !itemDef) return false;

    if (itemId === 'defuseKit') {
      if (actor.team !== 'Sentinels') return false;
      if (actor.hasDefuseKit) return false;
      if (actor.money < itemDef.price) return false;
      actor.money -= itemDef.price;
      actor.hasDefuseKit = true;
      return true;
    }
    if (itemId === 'armor') {
      if (actor.armor) return false;
      if (actor.money < itemDef.price) return false;
      actor.money -= itemDef.price;
      actor.armor = true;
      return true;
    }
    if (itemId === 'helmet') {
      // Helmet is sold as armor+helmet: it includes the vest.
      if (actor.helmet) return false;
      if (actor.money < itemDef.price) return false;
      actor.money -= itemDef.price;
      actor.armor = true;
      actor.helmet = true;
      return true;
    }
    if (itemId === 'he') {
      if ((actor.grenades || 0) >= CONFIG.items.he.maxPerActorPerRound) return false;
      if (actor.money < itemDef.price) return false;
      actor.money -= itemDef.price;
      actor.grenades = (actor.grenades || 0) + 1;
      return true;
    }
    // Weapons.
    if (!weaponDef) return false;
    if (!actor.weapons) return false;
    if (actor.weapons.has(itemId)) return false;
    if (actor.money < weaponDef.price) return false;
    actor.money -= weaponDef.price;
    actor.weapons.add(itemId);
    actor.weapons.switchTo(itemId);
    return true;
  },

  // Kill reward, paid at the moment of the kill. Shotguns pay more for
  awardKill(killer, weaponId) {
    if (!killer) return 0;
    const e = CONFIG.economy;
    let amount = e.killReward;
    if (weaponId === 'mule') amount = e.killRewardShotgun;
    else if (weaponId === 'vigil') amount = e.killRewardSniper;
    pay(killer, amount);
    return amount;
  },

  // Plant reward: the planter gets a personal bonus and every teammate
  awardPlant(planter, teamActors) {
    const e = CONFIG.economy;
    if (planter) pay(planter, e.plantPersonal);
    for (const actor of teamActors || []) {
      if (actor && actor !== planter) pay(actor, e.plantTeam);
    }
    // The planter is a teammate too: they get the team bonus as well.
    if (planter) pay(planter, e.plantTeam);
    return e.plantPersonal + e.plantTeam;
  },

  // Defuse reward: personal bonus to the defuser.
  awardDefuse(defuser) {
    if (!defuser) return 0;
    pay(defuser, CONFIG.economy.defusePersonal);
    return CONFIG.economy.defusePersonal;
  },

  // End-of-round pay. Winners are paid per player by how the round was
  awardRound(winnerTeam, reason, actors, lossStreak) {
    const e = CONFIG.economy;
    let winAmount = e.winElimination;
    if (reason === 'charge' || reason === 'defuse') winAmount = e.winCharge;
    else if (reason === 'time') winAmount = e.winTime;
    const loserTeam = winnerTeam === 'Strikers' ? 'Sentinels' : 'Strikers';
    const streak = (lossStreak && lossStreak[loserTeam]) || 0;
    const lossAmount = e.lossBase + Math.min(streak * e.lossBonusPerStreak, e.lossBonusMax);
    for (const actor of actors || []) {
      if (!actor) continue;
      if (actor.team === winnerTeam) pay(actor, winAmount);
      else if (actor.team === loserTeam) pay(actor, lossAmount);
    }
    return { winAmount, lossAmount };
  },

};
