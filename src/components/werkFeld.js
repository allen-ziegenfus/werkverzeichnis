/**
 * Anzeige von Werkfeldern und ihrer Werte: Felder außerhalb des Formulars (#181,
 * #180), und der Freitext „Werkgruppe“ als „Art“ (#189).
 */
export const werkFeld = f => ({ ausgeblendet: "Ausgeblendet", Werkgruppe: "Art", images: "Bilder" })[f] ?? f;
// Bilder (#180) mit Dateinamen statt vollem Pfad im Bucket.
export const werkWert = v => v == null || v === "" ? "∅" : v === true ? "ja" : v === false ? "nein"
  : Array.isArray(v) ? (v.length ? v.map(p => String(p).split("/").pop()).join(", ") : "∅") : String(v);

/** Zwei Werte eines Felds gleich? Listen (Bilder) nach Inhalt, nicht nach Identität. */
export const gleicherWert = (a, b) => Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b;
