/**
 * Anzeige von Werkfeldern und ihrer Werte: Felder außerhalb des Formulars (#181),
 * und der Freitext „Werkgruppe“ als „Art“ (#189).
 */
export const werkFeld = f => ({ ausgeblendet: "Ausgeblendet", Werkgruppe: "Art" })[f] ?? f;
export const werkWert = v => v == null || v === "" ? "∅" : v === true ? "ja" : v === false ? "nein" : String(v);
