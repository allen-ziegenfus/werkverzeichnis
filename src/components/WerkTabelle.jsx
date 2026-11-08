import { useEffect, useRef, useState } from "react";
import { Vorschaubild } from "./BildVorschau.jsx";

/**
 * Die Werke einer Werkgruppe als Tabelle (#248): kleines Bild, Inv. Nr., Titel,
 * Jahr und je Zeile ein Menü. Ein Klick auf die Zeile öffnet das Werk. Das Bild
 * ist das erste des Werks, wie es jetzt ist, auch vor dem Veröffentlichen (#270).
 *
 * - veroeffentlicht: Map Werk-ID → { gruppe, bild } aus der veröffentlichten
 *   Website (useVeroeffentlicht); was dort fehlt, ist (noch) nicht online und
 *   hat keinen Link. Der Link nimmt die veröffentlichte Werkgruppe:
 *   Ein verschobenes oder ausgeblendetes Werk bleibt bis zum nächsten
 *   Veröffentlichen dort.
 * - gruppen: die Werkgruppen ({ id, titel }), für „noch unter …“.
 */
export default function WerkTabelle({ werke, veroeffentlicht, gruppen, onOeffnen, onVerlauf }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-gray-600 border-b">
        <tr>
          <th className="py-1 w-14"><span className="sr-only">Bild</span></th>
          <th className="py-1 px-2 font-normal">Inv. Nr.</th>
          <th className="py-1 px-2 font-normal">Titel</th>
          <th className="py-1 px-2 font-normal">Jahr</th>
          <th className="py-1 w-10"><span className="sr-only">Aktionen</span></th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {werke.map(w => {
          const online = veroeffentlicht?.get(w.id);
          const verschoben = online && online.gruppe !== w.data.werkgruppe;
          const alteGruppe = verschoben && (gruppen?.find(g => g.id === online.gruppe)?.titel ?? online.gruppe);
          const website = online
            ? { text: "Auf der Website ansehen", href: `/${online.gruppe}/${w.id}/`,
                zusatz: w.data.ausgeblendet ? "ausgeblendet, beim nächsten Veröffentlichen weg"
                  : verschoben ? `noch unter ${alteGruppe}` : undefined }
            : { text: "Auf der Website ansehen", aus: w.data.ausgeblendet ? "ausgeblendet" : "noch nicht veröffentlicht" };
          return (
            <tr key={w.id} className={"cursor-pointer hover:bg-gray-50" + (w.data.ausgeblendet ? " text-gray-500" : "")}
                onClick={() => { if (!getSelection()?.toString()) onOeffnen(w); }}>
              <td className="py-1">
                <Vorschaubild key={w.data.images?.[0]} pfad={w.data.images?.[0]} />
              </td>
              <td className="py-1 px-2 font-mono whitespace-nowrap">{w.data.InvNr}</td>
              <td className="py-1 px-2">
                {/* Für die Tastatur: die Zeile selbst ist kein Bedienelement. */}
                <button className="text-left hover:underline" onClick={e => { e.stopPropagation(); onOeffnen(w); }}>
                  {w.data.Titel || <span className="text-gray-500">ohne Titel</span>}
                </button>
                {w.data.ausgeblendet && <span> · ausgeblendet</span>}
              </td>
              <td className="py-1 px-2 whitespace-nowrap">{w.data.Jahr}</td>
              <td className="py-1 text-right" onClick={e => e.stopPropagation()}>
                <Menue titel={w.data.Titel || w.data.InvNr} eintraege={[
                  { text: "Bearbeiten", tun: () => onOeffnen(w) },
                  website,
                  { text: "Verlauf", tun: () => onVerlauf(w) },
                ]} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Ein aufklappbares Menü (⋮), bewusst ohne role="menu" (das verspräche
 * Pfeiltasten): Tab geht durch die Einträge, Escape schließt und gibt den Fokus
 * an ⋮ zurück, ebenso schließen ein Klick daneben, der Fokus außerhalb und die Wahl.
 */
function Menue({ titel, eintraege }) {
  const [auf, setAuf] = useState(false);
  const rahmen = useRef(), knopf = useRef();
  useEffect(() => {
    if (!auf) return;
    const daneben = e => { if (!rahmen.current?.contains(e.target)) setAuf(false); };
    const taste = e => { if (e.key === "Escape") { setAuf(false); knopf.current?.focus(); } };
    document.addEventListener("mousedown", daneben);
    document.addEventListener("keydown", taste);
    return () => { document.removeEventListener("mousedown", daneben); document.removeEventListener("keydown", taste); };
  }, [auf]);
  const zeile = "block w-full text-left px-3 py-1.5 whitespace-nowrap";
  const zusatz = t => t && <span className="text-xs text-gray-500"> ({t})</span>;
  return (
    <div className="relative inline-block" ref={rahmen}
         onBlur={e => { if (!rahmen.current?.contains(e.relatedTarget)) setAuf(false); }}>
      <button ref={knopf} className="px-2 py-1 rounded hover:bg-gray-200 text-lg leading-none" aria-expanded={auf}
              aria-label={`Aktionen für ${titel}`} onClick={() => setAuf(!auf)}>⋮</button>
      {auf && (
        <div className="absolute right-0 z-20 mt-1 bg-white text-gray-900 border border-gray-300 rounded shadow-lg py-1 text-sm">
          {eintraege.map(e => e.href ? (
            <a key={e.text} className={zeile + " hover:bg-gray-100"} href={e.href}
               target="_blank" rel="noopener" onClick={() => setAuf(false)}>{e.text} ↗{zusatz(e.zusatz)}</a>
          ) : e.aus ? (
            <span key={e.text} className={zeile + " text-gray-400"}>{e.text}{zusatz(e.aus)}</span>
          ) : (
            <button key={e.text} className={zeile + " hover:bg-gray-100"}
                    onClick={() => { setAuf(false); e.tun(); }}>{e.text}</button>
          ))}
        </div>
      )}
    </div>
  );
}
