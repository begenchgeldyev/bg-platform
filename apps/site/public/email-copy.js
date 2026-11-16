(() => {
  // Delegation survives replaced HTMX fragments; reexecuted scripts never add listeners.
  if (window.__emailCopyInstalled) return;
  window.__emailCopyInstalled = true;
  const states = new WeakMap();
  let mouseButton = null;

  async function copy(button) {
    const state = states.get(button) || {};
    if (state.pending) return;
    states.set(button, state);
    const status = document.getElementById(button.getAttribute('aria-describedby'));
    if (!status) return;
    clearTimeout(state.timer);
    status.textContent = '';
    state.pending = true;
    let success = false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(button.dataset.copyEmail);
      success = true;
    } catch {
      // Leave the address selectable; never silently open a mail client on failure.
    } finally {
      state.pending = false;
    }
    if (!button.isConnected) return;
    status.textContent = success ? button.dataset.copySuccess : button.dataset.copyFailure;
    state.timer = setTimeout(
      () => {
        status.textContent = '';
      },
      success ? 2500 : 6000,
    );
  }

  document.addEventListener('mousedown', (event) => {
    mouseButton = null;
    if (event.button !== 0) return;
    const button = event.target.closest?.('[data-copy-email]');
    if (!button) return;
    mouseButton = button;
    // Do not preventDefault: keep native focus and manual text selection available.
    copy(button);
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-copy-email]');
    const alreadyHandled = event.detail > 0 && mouseButton === button;
    mouseButton = null;
    if (button && !alreadyHandled) copy(button);
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') mouseButton = null;
  });
})();
