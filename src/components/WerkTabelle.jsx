import { useEffect, useRef, useState } from "react";

/**
 * Die Werke einer Werkgruppe als Tabelle (#248): kleines Bild, Inv. Nr., Titel,
 * Jahr und je Zeile ein Menü. Ein Klick auf die Zeile öffnet das Werk.
 *
 * - veroeffentlicht: Map `<werkgruppe>/<werk>` → Vorschaubild oder null, aus der
 *   veröffentlichten Website (searchData.json); was dort fehlt, ist (noch) nicht
 *   veröffentlicht und hat weder Bild noch Link.
 */
export default function WerkTabelle({ werke, veroeffentlicht, onOeffnen, onVerlauf }) {
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
          const schluessel = `${w.data.werkgruppe}/${w.id}`;
          const online = !w.data.ausgeblendet && veroeffentlicht?.has(schluessel);
          return (
            <tr key={w.id} className={"cursor-pointer hover:bg-gray-100" + (w.data.ausgeblendet ? " text-gray-500" : "")}
                onClick={() => onOeffnen(w)}>
              <td className="py-1">
                <Vorschau src={veroeffentlicht?.get(schluessel)} />
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
                  online
                    ? { text: "Auf der Website ansehen", href: `/${w.data.werkgruppe}/${w.id}/` }
                    : { text: "Auf der Website ansehen", aus: w.data.ausgeblendet ? "Ausgeblendet" : "Noch nicht veröffentlicht" },
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

function Vorschau({ src }) {
  const [kaputt, setKaputt] = useState(false);
  if (!src || kaputt) return <div className="w-12 h-12 bg-gray-100 rounded" />;
  return <img src={src} alt="" loading="lazy" className="w-12 h-12 object-cover rounded" onError={() => setKaputt(true)} />;
}

/** Ein Menü (⋮); schließt mit Escape, einem Klick daneben oder nach der Wahl. */
function Menue({ titel, eintraege }) {
  const [auf, setAuf] = useState(false);
  const rahmen = useRef();
  useEffect(() => {
    if (!auf) return;
    const daneben = e => { if (!rahmen.current?.contains(e.target)) setAuf(false); };
    const taste = e => { if (e.key === "Escape") setAuf(false); };
    document.addEventListener("mousedown", daneben);
    document.addEventListener("keydown", taste);
    return () => { document.removeEventListener("mousedown", daneben); document.removeEventListener("keydown", taste); };
  }, [auf]);
  const zeile = "block w-full text-left px-3 py-1.5 whitespace-nowrap";
  return (
    <div className="relative inline-block" ref={rahmen}>
      <button className="px-2 py-1 rounded hover:bg-gray-200 text-lg leading-none" aria-haspopup="menu" aria-expanded={auf}
              aria-label={`Aktionen für ${titel}`} onClick={() => setAuf(!auf)}>⋮</button>
      {auf && (
        <div role="menu" className="absolute right-0 z-20 mt-1 bg-white border border-gray-300 rounded shadow-lg py-1 text-sm">
          {eintraege.map(e => e.href ? (
            <a key={e.text} role="menuitem" className={zeile + " hover:bg-gray-100"} href={e.href}
               target="_blank" rel="noopener" onClick={() => setAuf(false)}>{e.text} ↗</a>
          ) : e.aus ? (
            <span key={e.text} role="menuitem" aria-disabled="true" className={zeile + " text-gray-400"} title={e.aus}>
              {e.text} <span className="text-xs">({e.aus})</span>
            </span>
          ) : (
            <button key={e.text} role="menuitem" className={zeile + " hover:bg-gray-100"}
                    onClick={() => { setAuf(false); e.tun(); }}>{e.text}</button>
          ))}
        </div>
      )}
    </div>
  );
}
