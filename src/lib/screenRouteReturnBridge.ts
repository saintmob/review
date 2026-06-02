const DEFAULT_CLOUDFLARE_STATE_URL = 'https://vad-26-show-control.saintmob.workers.dev/api/state';
const DEFAULT_FIREBASE_DATABASE_URL = 'https://vad-gafa-26-default-rtdb.asia-southeast1.firebasedatabase.app';
const DEFAULT_SHOW_ID = 'show-main';
const POLL_INTERVAL_MS = 1000;

type ScreenRoute = {
  owner?: string;
  url?: string | null;
};

export function startScreenRouteReturnBridge(options: { stateUrl?: string; databaseUrl?: string; showId?: string } = {}) {
  if (typeof window === 'undefined') return () => undefined;
  if (window.parent !== window) return () => undefined;

  const screenId = readScreenId();
  if (!screenId) return () => undefined;

  const env = import.meta.env || {};
  const showId = options.showId ||
    readQueryValue('room') ||
    readQueryValue('showId') ||
    env.VITE_SHOW_ID ||
    DEFAULT_SHOW_ID;
  const stateUrl = buildCloudflareStateUrl(
    options.stateUrl ||
      env.VITE_SHOW_STATE_URL ||
      env.VITE_CLOUDFLARE_STATE_URL ||
      DEFAULT_CLOUDFLARE_STATE_URL,
    showId,
  );
  const firebaseRouteUrl = buildFirebaseRouteUrl(
    options.databaseUrl ||
      env.VITE_SHOW_STATE_DATABASE_URL ||
      env.VITE_FIREBASE_DATABASE_URL ||
      DEFAULT_FIREBASE_DATABASE_URL,
    showId,
    screenId,
  );
  let disposed = false;
  let timer = 0;
  let lastTarget = '';

  const checkRoute = async () => {
    if (disposed) return;
    try {
      const route = await fetchCloudflareRoute(stateUrl, screenId) || await fetchFirebaseRoute(firebaseRouteUrl);
      const targetUrl = routeTargetUrl(route);
      if (!targetUrl || targetUrl === lastTarget || isCurrentUrl(targetUrl)) return;
      lastTarget = targetUrl;
      window.location.replace(targetUrl);
    } catch {
      // Polling continues; the page should not fail just because routing is temporarily unavailable.
    }
  };

  void checkRoute();
  timer = window.setInterval(checkRoute, POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    window.clearInterval(timer);
  };
}

async function fetchCloudflareRoute(stateUrl: string, screenId: string) {
  const response = await fetch(stateUrl, { cache: 'no-store' });
  if (!response.ok) return null;
  const state = await response.json();
  return state?.modules?.interaction?.screenRoutes?.[screenId] as ScreenRoute | null || null;
}

async function fetchFirebaseRoute(routeUrl: string) {
  const response = await fetch(routeUrl, { cache: 'no-store' });
  if (!response.ok) return null;
  return await response.json() as ScreenRoute | null;
}

function routeTargetUrl(route: ScreenRoute | null) {
  if (!route?.url) return '';
  if (route.owner === 'vj' || route.owner === 'baofa') return route.url;
  if (route.owner === 'external' && !isCurrentUrl(route.url)) return route.url;
  return '';
}

function readScreenId() {
  return readQueryValue('screenId') ||
    readQueryValue('screen') ||
    readQueryValue('screen_id') ||
    readPathScreenId();
}

function readQueryValue(name: string) {
  return new URLSearchParams(window.location.search).get(name)?.trim() || '';
}

function readPathScreenId() {
  const match = window.location.pathname.match(/\/screen\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function isCurrentUrl(value: string) {
  try {
    const current = new URL(window.location.href);
    const target = new URL(value, current);
    current.hash = '';
    target.hash = '';
    return current.toString() === target.toString();
  } catch {
    return false;
  }
}

function normalizeBase(value: string) {
  return String(value || '').replace(/\/+$/, '');
}

function sanitizeFirebasePath(value: string) {
  return String(value || DEFAULT_SHOW_ID).replace(/[.#$/[\]]/g, '-');
}

function buildCloudflareStateUrl(value: string, showId: string) {
  const url = new URL(value || DEFAULT_CLOUDFLARE_STATE_URL);
  if (showId && showId !== DEFAULT_SHOW_ID) url.searchParams.set('room', showId);
  return url.toString();
}

function buildFirebaseRouteUrl(databaseUrl: string, showId: string, screenId: string) {
  return `${normalizeBase(databaseUrl)}/shows/${sanitizeFirebasePath(showId)}/state/modules/interaction/screenRoutes/${sanitizeFirebasePath(screenId)}.json`;
}
