import { gleich } from "./feldweise.js";
import { felderAenderungen } from "../werkverzeichnis/felder.js";

/** Die Einstellungen der Künstler:in (Einstellungen.jsx) und ihre Beschriftung. */
export const EINSTELLUNGEN = [
  ["titel", "Name"],
  ["websiteTitel", "Titel der Website"],
  ["titelZeile1", "Titel mobil, Zeile 1"],
  ["titelZeile2", "Titel mobil, Zeile 2"],
  ["copyright", "Copyright"],
];

/** Beschriftung eines Schlüssels aus lesen(), für den Verlauf. */
export const einstellungsName = k => k === "felder" ? "Felder der Werke" : EINSTELLUNGEN.find(([x]) => x === k)?.[1] ?? k;

/**
 * Was zwischen zwei Fassungen aus lesen() geändert ist, für Verlauf und offene
 * Änderungen; die Feldliste je Feld (#325).
 */
export function einstellungsAenderungen(vorher = {}, nachher = {}) {
  return [...new Set([...Object.keys(vorher), ...Object.keys(nachher)])]
    .filter(k => !gleich(vorher[k], nachher[k]))
    .map(k => k !== "felder" ? einstellungsName(k)
      : `${einstellungsName(k)} (${felderAenderungen(vorher.felder, nachher.felder).join("; ")
        // Sichtbar gleich, nur gespeichert oder weggefallen: die Standardfelder.
        || (nachher.felder === undefined ? "Standardfelder, keine eigene Liste mehr" : "Standardfelder gespeichert")})`);
}
