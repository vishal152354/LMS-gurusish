/* mcq-dnd.js — drag-and-drop answering for MCQ questions.
 *
 * Pointer Events (one code path for mouse, touch and pen) instead of HTML5 DnD,
 * which is janky on desktop and unsupported on touch. The dragged chip is a
 * fixed-position clone moved with translate3d inside requestAnimationFrame, so
 * only compositing happens per frame.
 *
 * Usage:
 *   const dnd = MCQDnD.mount(container, options, idx => submit(idx));
 *   dnd.lock();                         // while the answer is being sent
 *   dnd.unlock();                       // if the request failed
 *   dnd.reveal(correctIdx, chosenIdx);  // after grading
 *
 * Option chips are `.mcq-option` buttons in option order, so the existing
 * reveal / disable code that indexes `.mcq-option` keeps working.
 */
const MCQDnD = (() => {
  const LETTERS = 'ABCDEFGH';
  const DRAG_THRESHOLD = 5;      // px of movement before a press becomes a drag
  const MAGNET_RADIUS  = 90;     // px around the slot where the chip is pulled in
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active = null;             // the mounted question currently accepting answers

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

  function mount(container, options, onSubmit) {
    container.classList.add('dnd');
    container.innerHTML = `
      <div class="dnd-slot" role="group" aria-label="Answer slot" tabindex="-1">
        <div class="dnd-slot-empty">
          <span class="dnd-slot-icon" aria-hidden="true">⤓</span>
          <span>Drag the correct option here</span>
        </div>
        <div class="dnd-slot-filled" hidden>
          <span class="mcq-letter dnd-filled-letter"></span>
          <span class="dnd-filled-text"></span>
          <button type="button" class="dnd-clear" aria-label="Remove answer">✕</button>
        </div>
      </div>
      <div class="dnd-hint">Drag an option into the box — or tap it, or press A–${LETTERS[options.length - 1]}.</div>
      <div class="dnd-chips" role="list"></div>
      <div class="dnd-actions">
        <button type="button" class="dnd-submit" disabled>Submit answer</button>
      </div>
      <div class="sr-only" aria-live="polite"></div>`;

    const slot      = container.querySelector('.dnd-slot');
    const emptyEl   = container.querySelector('.dnd-slot-empty');
    const filledEl  = container.querySelector('.dnd-slot-filled');
    const chipsWrap = container.querySelector('.dnd-chips');
    const submitBtn = container.querySelector('.dnd-submit');
    const clearBtn  = container.querySelector('.dnd-clear');
    const live      = container.querySelector('[aria-live]');

    let chosen = null;     // option index currently in the slot
    let locked = false;

    const chips = options.map((opt, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mcq-option dnd-chip';
      b.setAttribute('role', 'listitem');
      b.setAttribute('aria-label', `Option ${LETTERS[i]}: ${opt}. Press to place in the answer box.`);
      b.innerHTML = `<span class="dnd-grip" aria-hidden="true">⋮⋮</span>` +
                    `<span class="mcq-letter">${LETTERS[i]}</span>` +
                    `<span class="mcq-text">${esc(opt)}</span>`;
      b.dataset.idx = i;
      chipsWrap.appendChild(b);
      return b;
    });

    // ── placing an answer ──────────────────────────────────────
    function place(idx, { fromRect = null } = {}) {
      if (locked) return;
      chosen = idx;
      chips.forEach((c, i) => c.classList.toggle('placed', i === idx));
      filledEl.querySelector('.dnd-filled-letter').textContent = LETTERS[idx];
      filledEl.querySelector('.dnd-filled-text').textContent = options[idx];
      emptyEl.hidden = true;
      filledEl.hidden = false;
      slot.classList.add('filled');
      submitBtn.disabled = false;
      live.textContent = `Option ${LETTERS[idx]} placed in the answer box. Press Submit answer to confirm.`;

      // FLIP: glide the filled content in from where the chip was released / sat
      if (fromRect && !reduceMotion()) {
        const to = filledEl.getBoundingClientRect();
        const dx = fromRect.left - to.left, dy = fromRect.top - to.top;
        const sx = fromRect.width / to.width;
        filledEl.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, 1)`, opacity: .85 },
           { transform: 'none', opacity: 1 }],
          { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      slot.animate && !reduceMotion() && slot.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'ease-out' });
    }

    function clear() {
      if (locked || chosen === null) return;
      chips[chosen].classList.remove('placed');
      chosen = null;
      emptyEl.hidden = false;
      filledEl.hidden = true;
      slot.classList.remove('filled');
      submitBtn.disabled = true;
      live.textContent = 'Answer box cleared.';
    }

    function submit() {
      if (locked || chosen === null) return;
      onSubmit(chosen, chips[chosen]);
    }

    // ── dragging ──────────────────────────────────────────────
    function startPress(e, sourceEl, idx) {
      if (locked || e.button > 0) return;
      const start = { x: e.clientX, y: e.clientY };
      const rect = sourceEl.getBoundingClientRect();
      const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      let drag = null;
      try { sourceEl.setPointerCapture(e.pointerId); } catch (err) {}   // keep moves coming if the pointer leaves the chip

      const onMove = ev => {
        if (!drag) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
          drag = beginDrag(sourceEl, idx, rect, grab);
        }
        drag.update(ev.clientX, ev.clientY);
      };
      const onUp = ev => {
        sourceEl.removeEventListener('pointermove', onMove);
        sourceEl.removeEventListener('pointerup', onUp);
        sourceEl.removeEventListener('pointercancel', onUp);
        if (drag) drag.end(ev.type === 'pointercancel');
        else if (ev.type === 'pointerup') {
          // a plain tap/click — place (or, from the slot, nothing)
          if (sourceEl !== filledEl) place(idx, { fromRect: rect });
        }
      };
      sourceEl.addEventListener('pointermove', onMove);
      sourceEl.addEventListener('pointerup', onUp);
      sourceEl.addEventListener('pointercancel', onUp);
    }

    function beginDrag(sourceEl, idx, rect, grab) {
      const fromSlot = sourceEl === filledEl;
      const ghost = (fromSlot ? chips[idx] : sourceEl).cloneNode(true);
      ghost.classList.remove('placed');
      ghost.classList.add('dnd-ghost');
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1.03)`;
      document.body.appendChild(ghost);
      if (fromSlot) { filledEl.style.visibility = 'hidden'; }
      else sourceEl.classList.add('dragging-src');
      document.body.classList.add('dnd-active');
      slot.classList.add('awaiting');
      buzz(8);

      let tx = rect.left, ty = rect.top;          // rendered position
      let px = rect.left, py = rect.top;          // pointer-derived target
      let lastX = px, tilt = 0, raf = null, over = false;
      const chat = document.getElementById('chatArea');

      function frame() {
        // magnet: when close to the slot, pull the target toward the slot centre
        const s = slot.getBoundingClientRect();
        const cx = px + rect.width / 2, cy = py + rect.height / 2;
        const sx = s.left + s.width / 2, sy = s.top + s.height / 2;
        const dist = Math.hypot(cx - sx, cy - sy);
        const inside = cx > s.left - 24 && cx < s.right + 24 && cy > s.top - 24 && cy < s.bottom + 24;
        over = inside || dist < MAGNET_RADIUS;
        let gx = px, gy = py;
        if (over) {
          const pull = inside ? 0.35 : 0.35 * (1 - dist / MAGNET_RADIUS);
          gx += (sx - cx) * pull; gy += (sy - cy) * pull;
        }
        slot.classList.toggle('drop-hover', over);

        // critically-damped follow: smooth, but never lags noticeably
        tx += (gx - tx) * 0.45; ty += (gy - ty) * 0.45;
        const vx = tx - lastX; lastX = tx;
        tilt += (Math.max(-6, Math.min(6, vx * 0.6)) - tilt) * 0.2;
        ghost.style.transform =
          `translate3d(${tx}px, ${ty}px, 0) rotate(${reduceMotion() ? 0 : tilt}deg) scale(${over ? 0.98 : 1.03})`;

        // auto-scroll the chat when dragging near its edges
        if (chat) {
          const c = chat.getBoundingClientRect();
          if (cy < c.top + 50) chat.scrollTop -= 10;
          else if (cy > c.bottom - 50) chat.scrollTop += 10;
        }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      return {
        update(x, y) { px = x - grab.x; py = y - grab.y; },
        end(cancelled) {
          cancelAnimationFrame(raf);
          document.body.classList.remove('dnd-active');
          slot.classList.remove('awaiting', 'drop-hover');
          const releasedRect = ghost.getBoundingClientRect();
          const finish = () => {
            ghost.remove();
            sourceEl.classList.remove('dragging-src');
            filledEl.style.visibility = '';
          };

          if (!cancelled && over) {
            buzz(12);
            finish();
            place(idx, { fromRect: releasedRect });
            return;
          }
          if (fromSlot) {
            // dragged out of the slot and dropped elsewhere → return it to the list
            finish();
            clear();
            return;
          }
          // spring back to the chip's home position
          const home = sourceEl.getBoundingClientRect();
          if (reduceMotion()) { finish(); return; }
          const anim = ghost.animate(
            [{ transform: ghost.style.transform },
             { transform: `translate3d(${home.left}px, ${home.top}px, 0) rotate(0deg) scale(1)` }],
            { duration: 280, easing: 'cubic-bezier(.3,1.4,.5,1)' });
          anim.onfinish = finish;
        },
      };
    }

    chips.forEach((chip, i) => {
      chip.addEventListener('pointerdown', e => startPress(e, chip, i));
      // keyboard: Enter/Space fires click without a pointer press
      chip.addEventListener('click', e => { if (e.detail === 0) place(i, { fromRect: chip.getBoundingClientRect() }); });
    });
    filledEl.addEventListener('pointerdown', e => {
      if (e.target === clearBtn || chosen === null) return;
      startPress(e, filledEl, chosen);
    });
    clearBtn.addEventListener('click', clear);
    submitBtn.addEventListener('click', submit);
    // stop the browser starting its own drag / text selection on the chips
    container.addEventListener('dragstart', e => e.preventDefault());

    const api = {
      container,
      handleKey(e) {
        if (locked) return false;
        const k = e.key.toUpperCase();
        const n = LETTERS.indexOf(k);
        if (n >= 0 && n < options.length) { place(n, { fromRect: chips[n].getBoundingClientRect() }); return true; }
        if ((e.key === 'Enter') && chosen !== null && !e.target.matches('textarea, input')) { submit(); return true; }
        if ((e.key === 'Backspace' || e.key === 'Delete') && chosen !== null) { clear(); return true; }
        return false;
      },
      lock() {
        locked = true;
        container.classList.add('locked');
        chips.forEach(c => c.disabled = true);
        submitBtn.disabled = true;
        clearBtn.hidden = true;
        submitBtn.textContent = 'Checking…';
      },
      unlock() {
        locked = false;
        container.classList.remove('locked');
        chips.forEach(c => c.disabled = false);
        clearBtn.hidden = false;
        submitBtn.disabled = chosen === null;
        submitBtn.textContent = 'Submit answer';
      },
      reveal(correctIdx, chosenIdx) {
        locked = true;
        if (active === api) active = null;
        container.classList.add('revealed');
        container.querySelector('.dnd-actions').hidden = true;
        container.querySelector('.dnd-hint').hidden = true;
        const ok = chosenIdx === correctIdx;
        slot.classList.add(ok ? 'is-correct' : 'is-wrong');
        if (typeof correctIdx === 'number' && chips[correctIdx]) chips[correctIdx].classList.add('correct');
        if (!ok && typeof chosenIdx === 'number' && chips[chosenIdx]) chips[chosenIdx].classList.add('wrong');
        live.textContent = ok ? 'Correct.' : `Incorrect. The correct answer is ${LETTERS[correctIdx]}.`;
      },
    };
    active = api;
    return api;
  }

  // one global key handler routes A–D / Enter to the question on screen
  document.addEventListener('keydown', e => {
    if (!active || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches && e.target.matches('textarea, input')) return;
    if (document.querySelector('.flash-overlay')) return;
    if (active.handleKey(e)) e.preventDefault();
  });

  return { mount };
})();
