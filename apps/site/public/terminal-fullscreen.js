(() => {
  const terminal = document.getElementById('terminal-wrap');
  const button = terminal?.querySelector('[data-terminal-fullscreen]');
  if (!button || !document.fullscreenEnabled || typeof terminal.requestFullscreen !== 'function') return;
  const input = document.getElementById('terminal-input');
  const status = terminal.querySelector('[data-fullscreen-status]');
  const copy =
    document.documentElement.lang === 'ru'
      ? {
          expand: 'Развернуть терминал',
          restore: 'Свернуть терминал',
          error: 'Не удалось изменить полноэкранный режим. Попробуйте ещё раз.',
        }
      : { expand: 'Expand terminal', restore: 'Restore terminal', error: 'Could not change fullscreen mode. Please try again.' };
  let wasFullscreen = false;
  let pending = false;

  function sync() {
    const fullscreen = document.fullscreenElement === terminal;
    button.setAttribute('aria-label', fullscreen ? copy.restore : copy.expand);
    button.setAttribute('title', fullscreen ? copy.restore : copy.expand);
    button.setAttribute('aria-pressed', String(fullscreen));
    if (fullscreen && !wasFullscreen) input?.focus({ preventScroll: true });
    if (!fullscreen && wasFullscreen) button.focus({ preventScroll: true });
    wasFullscreen = fullscreen;
  }

  async function toggle() {
    if (pending) return;
    pending = true;
    status.textContent = '';
    try {
      if (document.fullscreenElement === terminal) await document.exitFullscreen();
      else await terminal.requestFullscreen();
    } catch {
      status.textContent = copy.error;
      button.focus({ preventScroll: true });
    } finally {
      pending = false;
      sync();
    }
  }

  // The terminal wrapper focuses its input on click; do not let chrome clicks bubble.
  button.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    if (event.button === 0) {
      event.preventDefault();
      void toggle();
    }
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail === 0) void toggle();
  });
  terminal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.fullscreenElement === terminal) {
      event.preventDefault();
      void toggle();
    }
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
  terminal.querySelector('[data-terminal-toolbar]').style.removeProperty('display');
})();
