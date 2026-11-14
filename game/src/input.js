// SLAGLINE — keyboard and mouse, and the pointer lock that turns the mouse
// into look. Plain browser APIs only: the game asks the canvas for pointer
// lock and reads movementX/Y while it holds it.
// Keys are tracked two ways: the held set (state.keys) for movement and the
// hold-to-channel E key, and the edge queue (takePressed) for one-shot
// actions — B buy menu, G grenade, 1-5 weapon switch, R reload — so a held
// key never fires the same action twice.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = [];
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  function setKey(event, down) {
    if (down) {
      keys.add(event.code);
      // Edge queue: one entry per physical press, never on key repeat.
      if (!event.repeat) pressed.push(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    pressed.length = 0;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      pressed.length = 0;
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // Drain the edge queue: every code pressed since the last call, in
    takePressed() {
      const out = pressed.slice();
      pressed.length = 0;
      return out;
    },
  };
}
