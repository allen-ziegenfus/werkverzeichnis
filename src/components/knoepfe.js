/**
 * Knöpfe der Verwaltung (#238), überall gleich: Die Hauptaktion einer Ansicht
 * (Speichern, Anlegen) ist blau gefüllt; Veröffentlichen grün, weil nur es
 * etwas online stellt (#278); alles andere weiß mit Rand, Löschen rot
 * umrandet. Links (unterstrichen) bleiben Links.
 */
const basis = "rounded border shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none";
const gross = "px-3 py-1";
const klein = "px-2 py-0.5";

const haupt = "border-blue-700 bg-blue-700 text-white enabled:hover:bg-blue-800";
const neben = "border-gray-400 bg-white text-gray-900 enabled:hover:bg-gray-100";
const online = "border-green-700 bg-green-700 text-white enabled:hover:bg-green-800";
const gefahr = "border-red-700 bg-white text-red-700 enabled:hover:bg-red-50";

export const hauptknopf = `${basis} ${gross} ${haupt}`;
export const knopf = `${basis} ${gross} ${neben}`;
export const gefahrknopf = `${basis} ${gross} ${gefahr}`;
export const veroeffentlichenKnopf = `${basis} ${klein} ${online}`;
export const knopfKlein = `${basis} ${klein} ${neben}`;
