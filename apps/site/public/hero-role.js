(() => {
  const hero = document.querySelector('[data-hero-role]');
  if (!hero) return;
  const button = hero.querySelector('[data-role-switch]');
  const word = hero.querySelector('[data-role-word]');
  const label = hero.querySelector('[data-role-label]');
  const hint = hero.querySelector('#role-hint');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const copy =
    document.documentElement.lang === 'ru'
      ? {
          action: 'Нажмите, чтобы сменить роль.',
          running: 'Escape — остановить автоматическую смену. При наведении или фокусе она приостанавливается.',
          paused: 'Автоматическая смена остановлена. Escape — продолжить.',
          off: 'Анимация отключена в настройках уменьшения движения.',
        }
      : {
          action: 'Activate to switch role.',
          running: 'Escape pauses automatic changes. Hover or focus also suspends them.',
          paused: 'Automatic changes paused. Escape resumes them.',
          off: 'Animation is off because reduced motion is enabled.',
        };
  const titles = ['Software', 'AI'];
  let target = 0;
  let frame = 0;
  let timer = 0;
  let paused = false;
  let inView = false;
  let suspended = false;
  let hovered = false;
  let focused = false;

  const isActive = () => inView && !document.hidden && !suspended;

  function settle() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = 0;
    timer = 0;
    word.style.removeProperty('width');
    word.textContent = titles[target];
    // The heading changes only once per completed switch, never for scramble frames.
    // It is intentionally not live: automatic changes must not interrupt a screen reader.
    label.textContent = `${titles[target]} Engineer`;
  }

  function schedule() {
    clearTimeout(timer);
    timer = 0;
    if (isActive() && !paused && !hovered && !focused && !frame && !motion.matches) timer = setTimeout(switchRole, 4800);
  }

  function updatePause() {
    hint.textContent = `${copy.action} ${motion.matches ? copy.off : paused ? copy.paused : copy.running}`;
  }

  function switchRole() {
    settle();
    const source = titles[target];
    const fromWidth = word.getBoundingClientRect().width;
    target = 1 - target;
    if (motion.matches || !isActive()) {
      settle();
      schedule();
      return;
    }
    const title = titles[target];
    // Measure both real text runs. Interpolate the slot instead of jumping from
    // two glyphs to eight on the first frame of AI → Software.
    word.textContent = title;
    const toWidth = word.getBoundingClientRect().width;
    word.textContent = source;
    word.style.width = `${fromWidth}px`;
    const started = performance.now();
    let lastTick = -1;
    function draw(now) {
      const elapsed = now - started;
      const progress = Math.min(elapsed / 640, 1);
      if (progress === 1) {
        settle();
        schedule();
        return;
      }
      const eased = progress * progress * (3 - 2 * progress);
      const width = fromWidth + (toWidth - fromWidth) * eased;
      word.style.width = `${width}px`;
      const characters = '<>/_[]{}01';
      const tick = Math.floor(elapsed / 35);
      if (tick !== lastTick) {
        // Both directions get the same 140ms scramble lead-in and 500ms reveal,
        // normalized to the target length, not Software's eight-character width.
        const revealed = Math.floor(Math.max(0, (elapsed - 140) / 500) * title.length);
        const slots = Math.max(1, Math.round(width / (toWidth / title.length)));
        word.textContent = Array.from({ length: slots }, (_, index) =>
          index < revealed ? title[index] : characters[(tick + index * 3) % characters.length],
        ).join('');
        lastTick = tick;
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
  }

  button.disabled = false;
  updatePause();
  button.addEventListener('mousedown', (event) => {
    if (event.button === 0) switchRole();
  });
  button.addEventListener('click', (event) => {
    if (event.detail === 0) switchRole();
  });
  function togglePause() {
    if (motion.matches) return;
    paused = !paused;
    settle();
    updatePause();
    schedule();
  }
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.repeat) {
      event.preventDefault();
      togglePause();
    }
  });
  button.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    hovered = true;
    schedule();
  });
  button.addEventListener('pointerleave', () => {
    hovered = false;
    schedule();
  });
  button.addEventListener('focus', () => {
    focused = true;
    schedule();
  });
  button.addEventListener('blur', () => {
    focused = false;
    schedule();
  });

  function sync() {
    settle();
    updatePause();
    schedule();
  }
  const observer = new IntersectionObserver(([entry]) => {
    if (inView === entry.isIntersecting) return;
    inView = entry.isIntersecting;
    sync();
  });
  observer.observe(hero);
  motion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  function suspend() {
    suspended = true;
    observer.disconnect();
    settle();
  }
  window.addEventListener('pageswap', suspend);
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', () => {
    suspended = false;
    observer.observe(hero);
    sync();
  });
})();
