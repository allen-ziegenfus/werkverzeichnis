/**
 * Prüffehler am Feld (#329): roter Rand, Meldung darunter, für Screenreader
 * verknüpft (`aria-invalid`, `aria-describedby`). Die Speicherleiste zählt die
 * Felder mit `aria-invalid` und springt zum ersten.
 */
export const fehlerRand = "border-red-600 ring-1 ring-red-600 focus:outline-red-600";

/** Attribute fürs Eingabefeld; `weitere`: ids, die es schon beschreiben. */
export const fehlerAttribute = (id, text, ...weitere) => {
  const ids = [...weitere, text && id].filter(Boolean).join(" ");
  return { "aria-invalid": text ? true : undefined, "aria-describedby": ids || undefined };
};

export default function Feldfehler({ id, text }) {
  return text ? <span id={id} className="block text-sm text-red-700">{text}</span> : null;
}
