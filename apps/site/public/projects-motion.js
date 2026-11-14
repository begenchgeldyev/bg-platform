/* Actual scene playback, progressively enhanced over the untouched static picture.
 * Animated WebP has no pause API: stopping removes its source AND its node. A new
 * activation uses a fresh image, while the browser may reuse the encoded cache.
 * No animation URL is requested before decoded static art and eligible interaction.
 */
(() => {
  const BOOT = '__bgProjectsMotionBooted';
  if (window[BOOT]) return;
  window[BOOT] = true;

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const states = new Set();
  const stateByFrame = new WeakMap();
  const style = document.createElement('style');
  style.id = 'projects-image-motion-styles';
  style.textContent = `
    [data-image-motion-mode] { position: relative; }
    img[data-project-scene] {
      position: absolute; inset: 0; width: 100%; height: 100%;
      pointer-events: none; object-fit: cover;
    }
    .project-cover img[data-project-scene] { object-fit: contain; }
    img[data-project-scene][hidden] { display: none; }
    @media (prefers-reduced-motion: reduce) { img[data-project-scene] { display: none; } }
  `;
  document.head.append(style);

  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const state = stateByFrame.get(entry.target);
              if (!state) continue;
              state.visible = entry.isIntersecting && entry.intersectionRatio >= (state.mode === 'page' ? 0.35 : 0.01);
              apply(state);
            }
          },
          { threshold: [0, 0.01, 0.35] },
        )
      : null;

  function setState(state, value) {
    if (value) state.frame.setAttribute('data-image-motion', value);
    else state.frame.removeAttribute('data-image-motion');
  }

  function stop(state) {
    // Invalidate load/decode callbacks before clearing src (which can reject decode).
    const scene = state.scene;
    state.scene = null;
    if (!scene) return;
    scene.onload = null;
    scene.onerror = null;
    scene.hidden = true;
    scene.removeAttribute('src');
    scene.remove();
  }

  function eligible(state) {
    return (
      !state.disposed &&
      state.loaded &&
      state.frame.isConnected &&
      state.image.isConnected &&
      !state.image.closest('picture')?.hidden &&
      !reduceQuery.matches &&
      document.visibilityState !== 'hidden'
    );
  }

  function wanted(state) {
    return (
      eligible(state) &&
      state.visible &&
      !state.failed &&
      (state.mode === 'page' || (hoverQuery.matches && (state.hovered || state.focused)))
    );
  }

  function start(state) {
    const scene = new Image();
    state.scene = scene;
    scene.alt = '';
    scene.setAttribute('aria-hidden', 'true');
    scene.dataset.projectScene = '';
    scene.dataset.loaded = 'true';
    scene.decoding = 'async';
    scene.hidden = true;
    // Keep static picture painted throughout fetching and decoding. Only reveal a
    // successfully decoded scene belonging to this activation, never a stale load.
    const fail = () => {
      if (state.scene !== scene) return;
      state.failed = true;
      stop(state);
      setState(state, eligible(state) ? 'ready' : null);
    };
    scene.onerror = fail;
    scene.onload = async () => {
      try {
        await scene.decode();
        if (state.scene !== scene || !wanted(state)) return;
        if (!scene.naturalWidth) return fail();
        scene.hidden = false;
        setState(state, 'active');
      } catch {
        fail();
      }
    };
    state.frame.append(scene);
    scene.src = state.url;
    setState(state, 'loading');
  }

  function apply(state) {
    if (state.disposed) return;
    if (!wanted(state)) {
      stop(state);
      setState(state, eligible(state) ? 'ready' : null);
    } else if (!state.scene) start(state);
  }

  function syncLoaded(state) {
    const image = state.image;
    state.loaded = image.naturalWidth > 0 && (state.mode === 'card' ? image.dataset.loaded === 'true' : state.decoded);
    apply(state);
  }

  async function decodePage(state) {
    const version = ++state.decodeVersion;
    state.decoded = false;
    syncLoaded(state);
    try {
      await state.image.decode();
      if (state.disposed || version !== state.decodeVersion) return;
      state.decoded = state.image.naturalWidth > 0;
      syncLoaded(state);
    } catch {
      if (version === state.decodeVersion) syncLoaded(state);
    }
  }

  function register(image) {
    const mode = image.hasAttribute('data-project-cover') ? 'card' : 'page';
    const frame = mode === 'card' ? image.closest('.project-cover') : image.closest('picture')?.parentElement;
    if (!frame || stateByFrame.has(frame) || !image.dataset.projectMotion) return;
    const controller = new AbortController();
    const { signal } = controller;
    const card = mode === 'card' ? (image.closest('.project-card') ?? frame) : null;
    const state = {
      frame,
      image,
      mode,
      card,
      controller,
      url: image.dataset.projectMotion,
      scene: null,
      loaded: false,
      decoded: false,
      decodeVersion: 0,
      visible: false,
      hovered: card?.matches(':hover') ?? false,
      focused: card?.contains(document.activeElement) ?? false,
      failed: false,
      disposed: false,
    };
    stateByFrame.set(frame, state);
    states.add(state);
    frame.setAttribute('data-image-motion-mode', mode);
    image.addEventListener('load', () => (mode === 'card' ? syncLoaded(state) : decodePage(state)), { signal });
    image.addEventListener(
      'error',
      () => {
        state.decodeVersion++;
        state.decoded = false;
        state.loaded = false;
        apply(state);
      },
      { signal },
    );
    if (card) {
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
    }
    if (image.complete && image.naturalWidth > 0) {
      if (mode === 'card') syncLoaded(state);
      else decodePage(state);
    }
    // Without visibility observation prefer static over unbounded offscreen playback.
    observer?.observe(frame);
    apply(state);
  }

  function dispose(state) {
    state.disposed = true;
    state.decodeVersion++;
    stop(state);
    state.controller.abort();
    observer?.unobserve(state.frame);
    setState(state, null);
    state.frame.removeAttribute('data-image-motion-mode');
    stateByFrame.delete(state.frame);
    states.delete(state);
  }

  const selector = 'img[data-project-motion][data-project-cover], img[data-project-motion][data-project-preview]';
  function scan(root) {
    if (root.matches?.(selector)) register(root);
    for (const image of root.querySelectorAll(selector)) register(image);
  }

  new MutationObserver((records) => {
    // Prune before registration so replacing a picture inside the same frame works.
    for (const state of states) {
      if (!state.frame.isConnected || !state.image.isConnected) dispose(state);
    }
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      } else {
        const image = record.target.matches?.(selector) ? record.target : record.target.querySelector?.(selector);
        const frame = image?.closest('.project-cover') ?? image?.closest('picture')?.parentElement;
        const state = stateByFrame.get(frame);
        if (state) syncLoaded(state);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-loaded', 'hidden'] });

  document.addEventListener('visibilitychange', () => {
    for (const state of states) {
      if (state.card) {
        state.hovered = state.card.matches(':hover');
        state.focused = state.card.contains(document.activeElement);
      }
      apply(state);
    }
  });
  for (const query of [reduceQuery, hoverQuery])
    query.addEventListener('change', () => {
      for (const state of states) apply(state);
    });
  scan(document);
})();
