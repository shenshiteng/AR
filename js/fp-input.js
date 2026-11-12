/* =========================================================================
   fp-input.js —— 键盘 → 动作标志（window.FPInput）
   -------------------------------------------------------------------------
   键位（职责单一，互不兼职）：
     W / ↑ = 前进(fwd)   S / ↓ = 后退(back)   —— 只产生位移，绝不转向
     A     = 左转视角(turnL)                  D     = 右转视角(turnR)
     ← / → = 原地转身(turnL/turnR)（与 A/D 同一套转向逻辑）
     Shift + ←/→ = 左右平移（原有能力，保留）

   A/D 走的是「视角转向」这条既有逻辑：按住持续转、松开即停，
   转向速度仍由 fp-core 的 turnSpeed 决定，本次不改。

   用法：
     var action = {};
     FPInput.attach(window, action);
   之后每帧把 action 直接交给 FPWorld.step()。按下的键越多越强（布尔叠加）。
   ========================================================================= */
window.FPInput = (function () {
  'use strict';

  var KEYMAP = {
    ArrowUp: 'fwd', KeyW: 'fwd',
    ArrowDown: 'back', KeyS: 'back',
    ArrowLeft: 'turnL', ArrowRight: 'turnR',
    KeyA: 'turnLKey', KeyD: 'turnRKey'
  };

  var held = { shift: false };

  function keyName(ev) { return ev.code || ev.key; }

  function apply(action) {
    action.fwd = !!held.fwd;
    action.back = !!held.back;
    /* 转向：方向键（Shift 时降级为平移）+ A/D（A/D 永远转向，不受 Shift 影响） */
    action.turnL = (!!held.turnL && !held.shift) || !!held.turnLKey;
    action.turnR = (!!held.turnR && !held.shift) || !!held.turnRKey;
    /* 平移：只保留 Shift + ←/→ 这条老路，A/D 不再兼职平移 */
    action.strafeL = !!held.turnL && held.shift;
    action.strafeR = !!held.turnR && held.shift;
    return action;
  }

  /* 把按键事件绑定到 win，写入共享的 action 对象 */
  function attach(win, action) {
    win.addEventListener('keydown', function (ev) {
      var name = keyName(ev);
      if (name === 'ShiftLeft' || name === 'ShiftRight') held.shift = true;
      var a = KEYMAP[name];
      if (a) { held[a] = true; ev.preventDefault(); }
      apply(action);
    });

    win.addEventListener('keyup', function (ev) {
      var name = keyName(ev);
      if (name === 'ShiftLeft' || name === 'ShiftRight') held.shift = false;
      var a = KEYMAP[name];
      if (a) { held[a] = false; }
      apply(action);
    });

    win.addEventListener('blur', function () {
      // 失焦时清空，避免按键「卡住」
      for (var k in held) if (k !== 'shift') held[k] = false;
      apply(action);
    });

    return { held: held, apply: apply };
  }

  return { attach: attach, KEYMAP: KEYMAP };
})();
