(() => {
  const terminal = document.getElementById('terminal-wrap');
  const button = terminal?.querySelector('[data-terminal-fullscreen]');
  if (!button) return;

  const panel = terminal.hasAttribute('data-terminal-panel');
  const canFullscreen = document.fullscreenEnabled && typeof terminal.requestFullscreen === 'function';
  if (!panel && !canFullscreen) return;

  const launcher = document.querySelector('[data-terminal-launcher]');
  const close = terminal.querySelector('[data-terminal-close]');
  const input = document.getElementById('terminal-input');
  const status = terminal.querySelector('[data-fullscreen-status]');
  const expandIcon = button.querySelector('[data-expand-icon]');
  const restoreIcon = button.querySelector('[data-restore-icon]');
  const error =
    document.documentElement.lang === 'ru'
      ? 'Не удалось изменить полноэкранный режим. Попробуйте ещё раз.'
      : 'Could not change fullscreen mode. Please try again.';
  let wasExpanded = false;
  let expansion = null;
  let closing = false;

  const isNative = () => document.fullscreenElement === terminal;
  const isExpanded = () => isNative() || terminal.hasAttribute('data-terminal-viewport');
  const focus = (element) => element?.focus({ preventScroll: true });

  function sync() {
    const expanded = isExpanded();
    const label = expanded ? button.dataset.restoreLabel : button.dataset.expandLabel;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', String(expanded));
    expandIcon.toggleAttribute('hidden', expanded);
    restoreIcon.toggleAttribute('hidden', !expanded);
    if (!closing && expanded !== wasExpanded) focus(expanded ? input : button);
    wasExpanded = expanded;
  }

  async function changeExpansion() {
    status.textContent = '';
    try {
      if (isNative()) await document.exitFullscreen();
      else if (isExpanded()) terminal.removeAttribute('data-terminal-viewport');
      else if (canFullscreen) await terminal.requestFullscreen();
      else terminal.setAttribute('data-terminal-viewport', '');
    } catch {
      if (panel && !isNative() && !closing) terminal.setAttribute('data-terminal-viewport', '');
      else if (!closing) {
        status.textContent = error;
        focus(button);
      }
    } finally {
      sync();
    }
  }

  async function toggleExpansion() {
    if (closing || expansion) return;
    expansion = changeExpansion();
    await expansion;
    expansion = null;
  }

  function setOpen(open) {
    terminal.hidden = !open;
    terminal.inert = !open;
    launcher.setAttribute('aria-expanded', String(open));
    document.body.toggleAttribute('data-terminal-panel-open', open);
  }

  async function closePanel() {
    if (closing) return;
    closing = true;
    try {
      if (expansion) await expansion;
      if (isNative()) await document.exitFullscreen();
      terminal.removeAttribute('data-terminal-viewport');
      setOpen(false);
      status.textContent = '';
      focus(launcher);
    } catch {
      status.textContent = error;
      focus(close);
    } finally {
      sync();
      closing = false;
    }
  }

  // Mouse acts on press. Touch, pen, keyboard and assistive activation use click.
  function bind(control, activate) {
    let pressHandled = false;
    let pointerType = '';
    control.addEventListener('pointerdown', (event) => {
      pointerType = event.pointerType;
      pressHandled = false;
    });
    control.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      if (event.button !== 0 || pointerType === 'touch' || pointerType === 'pen' || event.sourceCapabilities?.firesTouchEvents) return;
      event.preventDefault();
      pressHandled = true;
      activate(false);
    });
    control.addEventListener('click', (event) => {
      event.stopPropagation();
      const nonMousePointer = (event.pointerType || pointerType) !== 'mouse' && event.detail !== 0;
      if (event.detail === 0 || !pressHandled) activate(nonMousePointer);
      pointerType = '';
      pressHandled = false;
    });
  }

  bind(button, toggleExpansion);
  terminal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing && isExpanded()) {
      event.preventDefault();
      void toggleExpansion();
    }
  });
  document.addEventListener('fullscreenchange', sync);
  sync();

  if (panel && launcher && close) {
    bind(launcher, (touch) => {
      if (!terminal.hidden) void closePanel();
      else {
        setOpen(true);
        focus(touch ? close : input);
      }
    });
    bind(close, closePanel);
    launcher.hidden = false;
  } else {
    terminal.querySelector('[data-terminal-toolbar]').style.removeProperty('display');
  }
})();
