(() => {
  const links = [...document.querySelectorAll('link[rel="icon"][data-site-icon-open][data-site-icon-closed]')];
  if (!links.length) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let ready = false;
  let failed = false;
  let timer = 0;
  let generation = 0;
  let remaining = links.length;

  function apply(closed) {
    for (const link of links) {
      link.setAttribute('href', closed ? link.dataset.siteIconClosed : link.dataset.siteIconOpen);
    }
  }

  function cancel() {
    clearTimeout(timer);
    timer = 0;
    // clearTimeout alone cannot invalidate a callback already queued by the browser.
    generation++;
  }

  function canBlink() {
    return ready && !failed && !document.hidden && !motion.matches;
  }

  function schedule(delay, callback) {
    cancel();
    const current = generation;
    timer = setTimeout(() => {
      if (current !== generation || !canBlink()) return;
      timer = 0;
      callback();
    }, delay);
  }

  function idle() {
    schedule(4000 + Math.random() * 3000, () => blink(Math.random() < 0.1));
  }

  function blink(double) {
    apply(true);
    schedule(150, () => {
      apply(false);
      if (double) schedule(150, () => blink(false));
      else idle();
    });
  }

  function reset() {
    cancel();
    if (!ready || failed) return;
    apply(document.hidden);
    if (canBlink()) idle();
  }

  document.addEventListener('visibilitychange', reset);
  motion.addEventListener('change', reset);

  // Keep the working static links until every closed frame has loaded. A failed
  // preload disables this controller rather than pointing a link at a broken PNG.
  for (const link of links) {
    const image = new Image();
    let settled = false;
    image.onload = () => {
      if (settled || failed) return;
      settled = true;
      remaining--;
      if (remaining === 0) {
        ready = true;
        reset();
      }
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      failed = true;
      cancel();
      apply(false);
    };
    image.src = link.dataset.siteIconClosed;
  }
})();
