/**
 * Der Browser-Verlauf der Verwaltung (#281): Jeder Eintrag trägt seine Stelle
 * (history.state.i), damit VerwaltungApp bei Zurück/Vor erkennt, wohin es geht,
 * und ein abgelehntes Verlassen zurückspringen kann. Bereiche, die selbst die
 * Adresse setzen (Werk-Editor: ?werk=, ?gruppe=), tun das hierüber.
 */
export const stelle = { i: globalThis.history?.state?.i ?? 0 };

/** Adresse setzen: `schritt` als neuer Eintrag (Zurück kehrt hierher zurück), sonst ersetzt. */
export function adresseSetzen(url, { schritt = false } = {}) {
  if (schritt) history.pushState({ i: ++stelle.i }, "", url);
  else history.replaceState({ ...history.state, i: stelle.i }, "", url);
}
