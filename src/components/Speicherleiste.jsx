import { hauptknopf, knopf } from "./knoepfe.js";
import { useEtwasUngespeichert } from "./ungespeichert.js";

/**
 * Leiste unten am Rand für Formulare (#328): Speichern bleibt bei langen
 * Formularen sichtbar, dazu ob etwas ungespeichert ist (dieselbe Quelle wie die
 * Warnung beim Verlassen, #324) und die Rückmeldung zum Speichern. Steht als
 * letztes Element im Formular; `-mx-4 px-4` wie der Rand von <main>.
 * `verwerfen` ist optional und fragt vorher nach; ohne `kannVerwerfen` geht es,
 * sobald etwas ungespeichert ist.
 */
export default function Speicherleiste({ speichern, kannSpeichern, speichert, beschriftung = "Speichern",
  verwerfen, kannVerwerfen, hinweis, fehler }) {
  const ungespeichert = useEtwasUngespeichert();
  return (
    <div className="sticky bottom-0 z-20 -mx-4 px-4 py-2 bg-white border-t shadow-[0_-2px_6px_rgba(0,0,0,0.08)]
                    flex flex-wrap gap-x-3 gap-y-1 items-center">
      <p role="status" className="flex-1 min-w-0 text-sm">
        {ungespeichert && <span className="text-amber-800 font-medium mr-2 whitespace-nowrap">● Ungespeichert<span className="hidden sm:inline">e Änderungen</span></span>}
        {fehler ? <span className="text-red-700">{fehler}</span>
          : !ungespeichert && hinweis && <span className="text-green-700">{hinweis}</span>}
      </p>
      {verwerfen && (
        <button className={knopf} disabled={speichert || !(kannVerwerfen ?? ungespeichert)}
                onClick={() => window.confirm("Ungespeicherte Änderungen verwerfen?") && verwerfen()}>Verwerfen</button>
      )}
      <button className={hauptknopf} disabled={speichert || !kannSpeichern} onClick={speichern}>
        {speichert ? "Speichere…" : beschriftung}
      </button>
    </div>
  );
}
