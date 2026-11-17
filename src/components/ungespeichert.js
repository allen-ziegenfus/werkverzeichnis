import { useEffect, useSyncExternalStore } from "react";

/**
 * Warnen vor ungespeicherten Änderungen (#202): Ein Formular meldet sich mit
 * `useUngespeichert(geaendert)` an. Schließen und Neuladen fragt dann der
 * Browser (`beforeunload`), Wechsel innerhalb der Verwaltung `verlassen()`.
 * Dieselbe Quelle zeigt die Speicherleiste an (#328, `useEtwasUngespeichert`).
 */
const offen = new Set();
const hoerer = new Set();
const melden = () => hoerer.forEach(f => f());

export function useUngespeichert(aktiv) {
  useEffect(() => {
    if (!aktiv) return;
    const marke = {};
    const warnen = e => { e.preventDefault(); e.returnValue = ""; };
    offen.add(marke); melden();
    addEventListener("beforeunload", warnen);
    return () => { offen.delete(marke); melden(); removeEventListener("beforeunload", warnen); };
  }, [aktiv]);
}

/** true, solange irgendein Formular ungespeicherte Änderungen gemeldet hat. */
const anmelden = f => { hoerer.add(f); return () => hoerer.delete(f); };
export const useEtwasUngespeichert = () => useSyncExternalStore(anmelden, () => offen.size > 0);

/** true, wenn nichts ungespeichert ist oder die Nutzer:in verwerfen will. */
export const verlassen = () => !offen.size || window.confirm("Ungespeicherte Änderungen verwerfen?");

/** Präfix der Entwürfe im Browser (Abgleich.jsx, #203); Abmelden löscht sie. */
export const ENTWURF = "werkverzeichnis-entwurf:";
export function entwuerfeLoeschen() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(ENTWURF)) localStorage.removeItem(k);
  } catch { /* gesperrt */ }
}
