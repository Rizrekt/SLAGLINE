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
// Menu order = the Digit1..Digit8 buy keys main.js routes while it is open.
export const BUY_ORDER = [...BUY_WEAPONS, ...BUY_ITEMS];

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
  const mmEl = $('minimap'), mm = mmEl ? mmEl.getContext('2d') : null;
  let hitTimer = 0;
  let last = {};
  let buyHandler = null;
  let buyOpen = false;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function buildBuy(owned = {}) {
    buyList.innerHTML = '';
    BUY_ORDER.forEach((id, i) => {
      const def = CONFIG.weapons[id] || CONFIG.items[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'buy-item';
      b.textContent = `${i + 1} · ${def.name} — $${def.price}${owned[id] ? ' ✓' : ''}`;
      b.addEventListener('click', () => { if (buyHandler) buyHandler(id); });
      buyList.appendChild(b);
    });
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
    buyIsOpen() { return buyOpen; },
    toggleBuy(phase) {
      if (phase !== 'FREEZE' && phase !== 'LIVE') return;
      if (buyOpen) this.hideBuy();
      else this.showBuy();
    },
    refreshBuy(money, owned) { this.setMoney(money); buildBuy(owned); },
    // Minimap from sim state only: walls, sites, actor dots, player tick.
    setMinimap(walls, sites, actors, me, plantedId) {
      if (!mm) return;
      const W = mmEl.width, H = mmEl.height;
      const sx = (x) => (x + 20.4) / 40.8 * W, sz = (z) => (z + 18.4) / 36.8 * H;
      const dot = (x, z, r) => { mm.beginPath(); mm.arc(sx(x), sz(z), r, 0, 7); mm.fill(); };
      mm.fillStyle = '#241d19';
      mm.fillRect(0, 0, W, H);
      mm.fillStyle = '#4a4d52';
      for (const b of walls) {
        if (b.max.y < 1) continue;
        mm.fillRect(sx(b.min.x), sz(b.min.z), sx(b.max.x) - sx(b.min.x), sz(b.max.z) - sz(b.min.z));
      }
      for (const s of sites) {
        const cx = sx(s.center.x), cy = sz(s.center.z);
        mm.strokeStyle = mm.fillStyle = s.id === 'A' ? '#ff9f1c' : '#b388ff';
        mm.lineWidth = 1.5;
        mm.beginPath(); mm.arc(cx, cy, 14, 0, 7); mm.stroke();
        mm.font = 'bold 10px ui-monospace, monospace';
        mm.fillText(s.id, cx - 3, cy + 3);
        if (s.id === plantedId) dot(s.center.x, s.center.z, 3.5);
      }
      for (const a of actors) {
        if (!a.alive || a === me) continue;
        mm.fillStyle = a.team === me.team ? '#2ec4b6' : '#f06423';
        dot(a.pos.x, a.pos.z, 2.6);
      }
      const px = sx(me.pos.x), py = sz(me.pos.z);
      mm.strokeStyle = mm.fillStyle = '#ffffff';
      mm.beginPath();
      mm.moveTo(px, py);
      mm.lineTo(px - Math.sin(me.yaw) * 9, py - Math.cos(me.yaw) * 9);
      mm.stroke();
      dot(me.pos.x, me.pos.z, 3.2);
    },
  };
}
