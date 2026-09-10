export const PAGES_HOSTNAME = 'erazahan.pages.dev';
export const PRODUCTION_ORIGIN = 'https://erazahan.info';

export function productionRedirectLocation(requestUrl: string): string | null {
  const incoming = new URL(requestUrl);
  if (incoming.hostname !== PAGES_HOSTNAME) return null;

  const destination = new URL(incoming.pathname, PRODUCTION_ORIGIN);
  destination.search = incoming.search;
  return destination.href;
}
