// Decorative feedback only. State, focus and exports never wait for animation.
export function createMotion(body) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set();
  const ghosts = new Set();
  const tokens = getComputedStyle(document.documentElement);
  const duration = (name) => parseFloat(tokens.getPropertyValue(`--motion-${name}`));
  const ease = tokens.getPropertyValue('--motion-ease').trim();
  const arcade = () => body.dataset.mode === 'arcade';
  const byId = (id) => document.getElementById(id);
  const eventNode = (id, surface = 'route') => [...document.querySelectorAll('[data-event-id]')]
    .find(node => node.dataset.eventId === id && node.dataset.surface === surface);

  function cancel() {
    animations.forEach(animation => animation.cancel());
    animations.clear();
    ghosts.forEach(node => node.remove());
    ghosts.clear();
  }
  function animate(node, frames, name = 'state', options = {}, cleanup = () => {}) {
    if (!node || reduced.matches || typeof node.animate !== 'function' || animations.size >= 8) { cleanup(); return; }
    const animation = node.animate(frames, { duration: duration(name), easing: ease, ...options });
    animations.add(animation);
    animation.finished.then(() => {
      animation.cancel(); // Release the effect rather than retaining a filled animation.
      animations.delete(animation); cleanup();
    }, () => { animations.delete(animation); cleanup(); });
  }
  function visibleRect(node) {
    if (!node || node.hidden) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth) return null;
    const viewport = node.closest('.route-viewport');
    if (viewport) {
      const clip = viewport.getBoundingClientRect();
      if (rect.left < clip.left || rect.right > clip.right || rect.top < clip.top || rect.bottom > clip.bottom) return null;
    }
    return rect;
  }
  function signal(node, complete = false) {
    if (!node || !visibleRect(node)) return;
    // An inset mark moves inside the stationary pointer/keyboard target.
    animate(node, [
      { boxShadow: `inset 0 0 0 2px ${complete ? '#536830' : '#e96840'}` },
      { boxShadow: `inset 0 0 0 2px ${complete ? '#53683000' : '#e9684000'}` },
    ], 'panel');
    const content = node.querySelector('.station-copy, .agenda-copy');
    if (content) animate(content, [{ transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }]);
  }
  function ghost(rect, text, className) {
    const node = document.createElement('span');
    node.className = `motion-flight ${className}`;
    node.setAttribute('aria-hidden', 'true');
    node.textContent = text;
    Object.assign(node.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    body.append(node); ghosts.add(node);
    return node;
  }
  function moveRecord(before, node) {
    const after = visibleRect(node);
    if (!arcade() || !before || !after || (Math.abs(before.left - after.left) < 2 && Math.abs(before.top - after.top) < 2)) return;
    const copy = ghost({ left: before.left, top: before.top, width: Math.min(before.width, after.width), height: before.height }, node.querySelector('.station-title')?.textContent || node.textContent, 'motion-record');
    animate(copy, [
      { transform: 'translate(0, 0)', opacity: .8 },
      { transform: `translate(${after.left - before.left}px, ${after.top - before.top}px)`, opacity: 0 },
    ], 'panel', {}, () => { copy.remove(); ghosts.delete(copy); });
  }
  function completion(id, completed, surface) {
    const check = eventNode(id, 'check');
    const route = eventNode(id);
    const icon = check?.querySelector('path');
    if (icon && completed) animate(icon, [{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], 'panel');
    signal(route, completed);
    if (!arcade()) return;
    const source = visibleRect(surface === 'route' ? route : check) || visibleRect(route);
    const target = visibleRect(byId('metric-done'));
    if (!completed || !source || !target) return;
    const start = { left: source.left + source.width / 2 - 10, top: source.top + source.height / 2 - 10, width: 20, height: 20 };
    const stamp = ghost(start, '✓', 'motion-stamp');
    const dx = target.left + target.width / 2 - 10 - start.left;
    const dy = target.top + target.height / 2 - 10 - start.top;
    animate(stamp, [
      { transform: 'translate(0, 0) rotate(-12deg)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * .45}px, ${dy * .6}px) rotate(8deg)`, opacity: 1, offset: .55 },
      { transform: `translate(${dx}px, ${dy}px) rotate(0)`, opacity: 0, offset: 1 },
    ], 'episode', {}, () => { stamp.remove(); ghosts.delete(stamp); });
  }
  function capture(id) { return visibleRect(eventNode(id)); }
  function play(effect, before, changedMetrics = []) {
    if (!effect?.type || reduced.matches) return;
    changedMetrics.slice(0, 2).forEach(id => animate(byId(id), [
      { transform: 'translateY(3px)', opacity: .6 }, { transform: 'translateY(0)', opacity: 1 },
    ]));
    const node = eventNode(effect.id);
    if (effect.type === 'select') {
      signal(node);
      animate(byId('detail-title'), [{ transform: 'translateX(-5px)', opacity: .7 }, { transform: 'translateX(0)', opacity: 1 }], 'panel');
    } else if (effect.type === 'complete') {
      completion(effect.id, effect.completed, effect.surface);
    } else if (effect.type === 'create' || effect.type === 'edit') {
      signal(node);
      signal(eventNode(effect.id, 'agenda'));
      if (effect.type === 'edit') moveRecord(before, node);
    } else if (effect.type === 'import') {
      [...document.querySelectorAll('.station, .all-day-block')].filter(visibleRect).slice(0, arcade() ? 3 : 1).forEach(item => signal(item));
    } else if (effect.type === 'day') {
      const distance = (effect.direction || 1) * 7;
      animate(byId('readout-date'), [{ transform: `translateX(${distance}px)`, opacity: .6 }, { transform: 'translateX(0)', opacity: 1 }], 'panel');
    }
  }
  reduced.addEventListener('change', cancel);
  // No retained effects when switching tabs, scrolling away, or leaving the scene.
  document.addEventListener('visibilitychange', cancel);
  byId('route-viewport')?.addEventListener('scroll', cancel, { passive: true });
  window.addEventListener('scroll', cancel, { passive: true });
  window.addEventListener('resize', cancel);
  window.addEventListener('pagehide', cancel);
  return { cancel, capture, play };
}
