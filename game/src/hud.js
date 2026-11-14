// SLAGLINE — DOM HUD. Never touches the sim; main.js pushes numbers in
// and reads the buy callback out. All ids come from index.html.
import { CONFIG } from './config.js';

const COPY = {
  start: {
    title: 'SLAGLINE — Foundry Yard',
    copy: 'Tactical 5v5. Plant the charge at Core A or Core B, or wipe the Sentinels. First to 9 rounds. Click to play.',
    action: 'Click to play',
  },
  paused: { title: 'SLAGLINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  end: { title: 'Match over', copy: '', action: 'Play again' },
};
const BUY_WEAPONS = ['p50', 'kestrel', 'mule', 'ar7', 'vigil'];
const BUY_ITEMS = ['he', 'armor', 'helmet'];

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay'), title = $('overlay-title'), copy = $('overlay-copy');
  const play = $('play'), ammo = $('ammo'), ammoMag = $('ammo-mag'), ammoReserve = $('ammo-reserve');
  const scoreEl = $('score-value'), hitmarker = $('hitmarker'), timerEl = $('timer-value');
  const phaseEl = $('phase-value'), moneyEl = $('money-value'), healthEl = $('health-value');
  const weaponEl = $('weapon-value'), zoneEl = $('zone-value'), roundEl = $('round-value');
  const killfeedEl = $('killfeed'), bannerEl = $('banner'), plantEl = $('plant');
  const plantFill = $('plant-fill'), plantLabel = $('plant-label');
  const buyEl = $('buy'), buyMoney = $('buy-money'), buyList = $('buy-list');
  const carrierEl = $('carrier'), scopeEl = $('scope'), kdEl = $('kd-value');
  let hitTimer = 0;
  let last = {};
  let buyHandler = null;
  let buyOpen = false;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function buildBuy() {
    buyList.innerHTML = '';
    const add = (id, name, price, owned) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'buy-item';
      b.textContent = `${name} — $${price}${owned ? ' ✓' : ''}`;
      b.addEventListener('click', () => { if (buyHandler) buyHandler(id); });
      buyList.appendChild(b);
    };
    for (const id of BUY_WEAPONS) {
      const w = CONFIG.weapons[id];
      add(id, w.name, w.price, false);
    }
    for (const id of BUY_ITEMS) {
      const item = CONFIG.items[id];
      add(id, item.name, item.price, false);
    }
  }
  buildBuy();

  return {
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'res', `/ ${reserve}`);
      ammo.classList.toggle('empty', mag === 0);
    },
    setRound(n, score) {
      setText(roundEl, 'round', `Round ${n}`);
      setText(scoreEl, 'score', `${score.Strikers} : ${score.Sentinels}`);
    },
    setKills(kills, deaths) { setText(kdEl, 'kd', `${kills}K / ${deaths}D`); },
    setMoney(v) { setText(moneyEl, 'money', `$${v}`); setText(buyMoney, 'buymoney', `$${v}`); },
    setHealth(v) { setText(healthEl, 'hp', `${v} HP`); healthEl.classList.toggle('low', v <= 30); },
    setWeapon(name, id) { setText(weaponEl, 'wpn', name); },
    setTimer(v) { setText(timerEl, 'timer', `${v}s`); },
    setPhase(phase, v) {
      setText(phaseEl, 'phase', phase === 'FREEZE' ? 'BUY' : phase);
      setText(timerEl, 'timer', `${v}s`);
    },
    setZone(name) { setText(zoneEl, 'zone', name); },
    setCarrier(has) { setText(carrierEl, 'carrier', has ? '◆ CHARGE' : ''); },
    setScope(on) { scopeEl.hidden = !on; },
    setPlant(plant, defuse, planted) {
      const p = plant > 0 ? plant : defuse;
      if (p > 0 || planted) {
        plantEl.hidden = false;
        plantFill.style.width = `${Math.round(p * 100)}%`;
        setText(plantLabel, 'plant', planted ? 'CHARGE TICKING' : (plant > 0 ? 'PLANTING…' : 'DEFUSING…'));
      } else plantEl.hidden = true;
    },
    setBanner(text) {
      if (last.banner === text) return;
      last.banner = text;
      bannerEl.textContent = text;
      bannerEl.hidden = false;
      clearTimeout(bannerEl._t);
      bannerEl._t = setTimeout(() => { bannerEl.hidden = true; }, 6000);
    },
    pushKillfeed(text) {
      const row = document.createElement('div');
      row.textContent = text;
      killfeedEl.prepend(row);
      while (killfeedEl.children.length > 4) killfeedEl.lastChild.remove();
      setTimeout(() => row.remove(), 7000);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end'
        ? `Strikers ${score.Strikers} — ${score.Sentinels} Sentinels.`
        : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
    onBuy(handler) { buyHandler = handler; },
    showBuy() { buyEl.hidden = false; buyOpen = true; },
    hideBuy() { buyEl.hidden = true; buyOpen = false; },
    toggleBuy(phase) {
      if (phase !== 'FREEZE' && phase !== 'LIVE') return;
      if (buyOpen) this.hideBuy();
      else this.showBuy();
    },
    refreshBuy(money) { this.setMoney(money); },
  };
}
