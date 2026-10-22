// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARTWORK_PATH_RE,
  artworkIdFromPath,
  createRouter,
  type Router,
} from '../../../src/content/router';

describe('artworkIdFromPath', () => {
  it.each([
    ['/artworks/135882741', '135882741'],
    ['/artworks/135882741/', '135882741'],
    ['/en/artworks/151061734', '151061734'],
    ['/ja/artworks/1', '1'],
    ['/zh-tw/artworks/42', '42'],
    ['/artworks/999999999999', '999999999999'],
  ])('artworkIdFromPath: %s → %s', (pathname, id) => {
    expect(artworkIdFromPath(pathname)).toBe(id);
  });

  it.each([
    '/',
    '/en/',
    '/users/40285173',
    '/en/users/16776564/artworks',
    '/artworks/',
    '/artworks/abc',
    '/artworks/1234567890123',
    '/artworks/135882741/extra',
    '/ajax/illust/135882741',
    '/novel/show.php',
    '/english/artworks/1',
    '/EN/artworks/1',
  ])('artworkIdFromPath: %s is not an artwork route', (pathname) => {
    expect(artworkIdFromPath(pathname)).toBeNull();
  });

  it('ARTWORK_PATH_RE: matches the pathname only (no query or hash)', () => {
    expect(ARTWORK_PATH_RE.test('/artworks/1?p=2')).toBe(false);
  });
});

describe('createRouter', () => {
  let navigation: EventTarget;
  let events: string[];
  let router: Router;

  function go(path: string): void {
    history.pushState(null, '', path);
    navigation.dispatchEvent(new Event('currententrychange'));
  }

  beforeEach(() => {
    navigation = new EventTarget();
    vi.stubGlobal('navigation', navigation);
    events = [];
    history.replaceState(null, '', '/artworks/135882741');
    router = createRouter({
      enter: (id) => events.push(`enter ${id}`),
      leave: () => events.push('leave'),
    });
  });

  afterEach(() => {
    router.stop();
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/');
  });

  it('router: start() enters the current artwork route', () => {
    router.start();
    expect(events).toEqual(['enter 135882741']);
  });

  it('router: start() on a non-artwork route emits nothing', () => {
    history.replaceState(null, '', '/users/40285173');
    router.start();
    expect([events, router.current()]).toEqual([[], null]);
  });

  it('router: current() is the artwork shown', () => {
    router.start();
    expect(router.current()).toBe('135882741');
  });

  it('router: artwork → artwork is leave then enter (currententrychange)', () => {
    router.start();
    go('/artworks/135882742');
    expect(events).toEqual(['enter 135882741', 'leave', 'enter 135882742']);
  });

  it('router: leaving for a non-artwork route only leaves', () => {
    router.start();
    go('/users/40285173');
    expect(events).toEqual(['enter 135882741', 'leave']);
  });

  it('router: entering from a non-artwork route only enters', () => {
    history.replaceState(null, '', '/');
    router.start();
    go('/en/artworks/151061734');
    expect(events).toEqual(['enter 151061734']);
  });

  it('router: popstate is a navigation signal too', () => {
    router.start();
    history.pushState(null, '', '/artworks/135882742');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(events).toEqual(['enter 135882741', 'leave', 'enter 135882742']);
  });

  it('router: check() catches a navigation no event announced', () => {
    router.start();
    history.pushState(null, '', '/artworks/135882742');
    router.check();
    expect(events).toEqual(['enter 135882741', 'leave', 'enter 135882742']);
  });

  it('router: the same artwork under a locale prefix is not a change', () => {
    router.start();
    go('/en/artworks/135882741');
    expect(events).toEqual(['enter 135882741']);
  });

  it('router: a query or hash change on the same artwork is not a change', () => {
    router.start();
    go('/artworks/135882741?p=1#comments');
    expect(events).toEqual(['enter 135882741']);
  });

  it('router: stop() removes the navigation listeners', () => {
    router.start();
    router.stop();
    go('/artworks/135882742');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(events).toEqual(['enter 135882741']);
  });
});
