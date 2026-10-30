/** Anzeige von Werkfeldern, die nicht im Formular stehen (#181), und ihrer Werte. */
export const werkFeld = f => ({ ausgeblendet: "Ausgeblendet" })[f] ?? f;
export const werkWert = v => v == null || v === "" ? "∅" : v === true ? "ja" : v === false ? "nein" : String(v);
