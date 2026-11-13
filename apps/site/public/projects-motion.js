/*
 * Authored image motion for project cards and project pages.
 *
 * The enhancement is decorative: it never changes an image source, source set,
 * loading mode or layout. A frame only becomes decorative once its image has
 * decoded. Cards move on hover or keyboard focus, project pages move while
 * visible, and everything stops for reduced motion, hidden documents, failed
 * images and coarse pointers. A single boot guard, per-frame state and a
 * mutation observer make repeated HTMX swaps idempotent and clean up detached
 * frames.
 */
(() => {
  const BOOT = '__bgProjectsMotionBooted';
  if (window[BOOT]) return;
  window[BOOT] = true;

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const supportsObserver = 'IntersectionObserver' in window;

  let reduced = reduceQuery.matches;
  let documentHidden = document.visibilityState === 'hidden';

  // One injected stylesheet keeps the gallery and project-page treatments identical,
  // and it cannot be lost when HTMX replaces gallery content.
  const STYLE_ID = 'projects-image-motion-styles';
  const MOTION_CSS = `
[data-image-motion] { position: relative; }
[data-image-motion]::before,
[data-image-motion]::after { content: ""; position: absolute; pointer-events: none; }
[data-image-motion]::after {
  inset: 0;
  opacity: 0;
  mix-blend-mode: screen;
  background-image: linear-gradient(
    108deg,
    transparent 0 44.6%,
    rgba(255, 176, 84, 0.06) 44.6% 45.8%,
    rgba(255, 190, 110, 0.13) 45.8% 46.6%,
    rgba(200, 255, 235, 0.3) 46.6% 47.4%,
    rgba(157, 255, 217, 0.13) 47.4% 48.4%,
    rgba(157, 255, 217, 0.06) 48.4% 49.6%,
    transparent 49.6% 100%
  );
  background-repeat: no-repeat;
  background-size: 220% 220%;
  background-position: 0% 0;
}
[data-image-motion]::before {
  inset: 7px;
  opacity: 0;
  background:
    linear-gradient(rgba(255, 196, 107, 0.62), rgba(255, 196, 107, 0.62)) left top / 14px 1px no-repeat,
    linear-gradient(rgba(255, 196, 107, 0.62), rgba(255, 196, 107, 0.62)) left top / 1px 14px no-repeat,
    linear-gradient(rgba(255, 196, 107, 0.62), rgba(255, 196, 107, 0.62)) right top / 14px 1px no-repeat,
    linear-gradient(rgba(255, 196, 107, 0.62), rgba(255, 196, 107, 0.62)) right top / 1px 14px no-repeat,
    linear-gradient(rgba(157, 255, 217, 0.58), rgba(157, 255, 217, 0.58)) left bottom / 14px 1px no-repeat,
    linear-gradient(rgba(157, 255, 217, 0.58), rgba(157, 255, 217, 0.58)) left bottom / 1px 14px no-repeat,
    linear-gradient(rgba(157, 255, 217, 0.58), rgba(157, 255, 217, 0.58)) right bottom / 14px 1px no-repeat,
    linear-gradient(rgba(157, 255, 217, 0.58), rgba(157, 255, 217, 0.58)) right bottom / 1px 14px no-repeat;
}
[data-image-motion="active"]::before { opacity: 1; }
[data-image-motion="active"]::after { animation: image-signal-sweep 3200ms steps(18, end) infinite; }
[data-image-motion-mode="page"][data-image-motion="active"]::after {
  animation-duration: 5200ms;
  animation-timing-function: steps(26, end);
}
@keyframes image-signal-sweep {
  0% { background-position: 0% 0; opacity: 0; }
  6% { opacity: 1; }
  72% { opacity: 1; }
  100% { background-position: 100% 0; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  [data-image-motion]::before,
  [data-image-motion]::after { animation: none; display: none; }
}
`;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = MOTION_CSS;
    document.head.append(style);
  }

  const states = new Set();
  const stateByFrame = new WeakMap();

  const observer = supportsObserver
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const state = stateByFrame.get(entry.target);
            if (!state) continue;
            const minimum = state.mode === 'page' ? 0.35 : 0.01;
            state.visible = entry.isIntersecting && entry.intersectionRatio >= minimum;
            apply(state);
          }
        },
        { threshold: [0, 0.01, 0.35] },
      )
    : null;

  function setState(state, next) {
    if (state.applied === next) return;
    state.applied = next;
    if (next) state.frame.setAttribute('data-image-motion', next);
    else state.frame.removeAttribute('data-image-motion');
  }

  function apply(state) {
    if (!state.loaded || reduced || documentHidden) {
      setState(state, null);
      return;
    }
    const active = state.mode === 'page' ? state.visible : state.visible && hoverQuery.matches && (state.hovered || state.focused);
    setState(state, active ? 'active' : 'ready');
  }

  function syncLoaded(state) {
    const image = state.image;
    const picture = image.closest('picture');
    if (!image.isConnected || picture?.hidden) {
      state.loaded = false;
      apply(state);
      return;
    }
    state.loaded =
      state.mode === 'hover' ? image.dataset.loaded === 'true' && image.naturalWidth > 0 : state.decoded === true && image.naturalWidth > 0;
    apply(state);
  }

  function fail(state) {
    state.decoded = false;
    state.loaded = false;
    apply(state);
  }

  function decodePageImage(state) {
    const image = state.image;
    if (image.complete && image.naturalWidth === 0) {
      fail(state);
      return;
    }
    const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
    decoded.then(
      () => {
        state.decoded = image.naturalWidth > 0;
        syncLoaded(state);
      },
      () => fail(state),
    );
  }

  function register(frame, image, mode) {
    if (!frame || stateByFrame.has(frame)) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const state = {
      frame,
      image,
      mode,
      card: null,
      controller,
      applied: null,
      loaded: false,
      decoded: mode === 'page' ? false : undefined,
      visible: false,
      hovered: false,
      focused: false,
    };
    stateByFrame.set(frame, state);
    states.add(state);
    frame.setAttribute('data-image-motion-mode', mode === 'page' ? 'page' : 'card');

    image.addEventListener(
      'load',
      () => {
        if (mode === 'hover') syncLoaded(state);
        else decodePageImage(state);
      },
      { signal },
    );
    image.addEventListener('error', () => fail(state), { signal });

    if (mode === 'hover') {
      const card = image.closest('.project-card') ?? frame;
      state.card = card;
      card.addEventListener(
        'pointerenter',
        () => {
          state.hovered = true;
          apply(state);
        },
        { signal },
      );
      card.addEventListener(
        'pointerleave',
        () => {
          state.hovered = false;
          apply(state);
        },
        { signal },
      );
      card.addEventListener(
        'focusin',
        () => {
          state.focused = true;
          apply(state);
        },
        { signal },
      );
      card.addEventListener(
        'focusout',
        (event) => {
          if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
          state.focused = false;
          apply(state);
        },
        { signal },
      );
      if (image.complete) syncLoaded(state);
    } else if (image.complete) {
      decodePageImage(state);
    }

    if (observer) observer.observe(frame);
    else state.visible = true;
    apply(state);
  }

  function dispose(state) {
    state.controller.abort();
    observer?.unobserve(state.frame);
    setState(state, null);
    state.frame.removeAttribute('data-image-motion-mode');
    stateByFrame.delete(state.frame);
    states.delete(state);
  }

  function pruneDetached() {
    for (const state of [...states]) {
      if (!state.frame.isConnected || !state.image.isConnected) dispose(state);
    }
  }

  function scanWithin(root) {
    if (!root) return;
    for (const image of root.querySelectorAll('img[data-project-cover]')) {
      const frame = image.closest('.project-cover');
      if (frame) register(frame, image, 'hover');
    }
    for (const image of root.querySelectorAll('img[data-project-preview]')) {
      const frame = image.closest('picture')?.parentElement;
      if (frame && frame !== document.body && frame !== document.documentElement) register(frame, image, 'page');
    }
    if (root.matches?.('img[data-project-cover]')) {
      const frame = root.closest('.project-cover');
      if (frame) register(frame, root, 'hover');
    }
    if (root.matches?.('img[data-project-preview]')) {
      const frame = root.closest('picture')?.parentElement;
      if (frame && frame !== document.body && frame !== document.documentElement) register(frame, root, 'page');
    }
  }

  // The attribute filter is narrow: our own decorative attributes never re-enter
  // the observer, so the enhancement cannot feed itself.
  const mutations = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      if (record.type === 'childList') {
        if (record.removedNodes.length > 0) removed = true;
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scanWithin(node);
        }
      } else if (record.type === 'attributes') {
        const target = record.target;
        const image = target.matches?.('img[data-project-cover]') ? target : target.querySelector?.('img[data-project-cover]');
        const frame = image?.closest('.project-cover');
        const state = frame ? stateByFrame.get(frame) : undefined;
        if (state) syncLoaded(state);
      }
    }
    if (removed) pruneDetached();
  });

  document.addEventListener('visibilitychange', () => {
    documentHidden = document.visibilityState === 'hidden';
    for (const state of states) {
      if (documentHidden) {
        state.hovered = false;
        state.focused = false;
      } else if (state.mode === 'hover' && state.card) {
        // A tab round-trip replays no pointer or focus event, so the flags cleared above are
        // stale. Read the live interaction back from the document instead of trusting them.
        state.hovered = state.card.matches(':hover');
        state.focused = state.card.contains(document.activeElement);
      }
      apply(state);
    }
  });

  reduceQuery.addEventListener('change', () => {
    reduced = reduceQuery.matches;
    for (const state of states) apply(state);
  });

  hoverQuery.addEventListener('change', () => {
    for (const state of states) apply(state);
  });

  ensureStyles();
  scanWithin(document);
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-loaded', 'hidden'] });
})();
