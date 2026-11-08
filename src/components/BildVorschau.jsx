import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { kuenstler, KUENSTLER } from "./firebaseClient.js";

/**
 * Die Bilder eines Werks mit Vorschau (#259). Die Bildfunktion (gcf/process.js)
 * trägt je Original unter medien/<md5> ein, was sie erzeugt hat; die
 * Webversionen liefert die Seite schon vor dem Veröffentlichen unter /bilder aus.
 * Bis der Eintrag da ist, „wird verarbeitet…“.
 */
export default function BildListe({ bilder }) {
  return (
    <ul className="flex flex-wrap gap-3">
      {bilder.map(p => <Bild key={p} pfad={p} />)}
    </ul>
  );
}

function Bild({ pfad }) {
  const [medium, setMedium] = useState();   // undefined: lädt, null: noch kein Eintrag
  useEffect(() => onSnapshot(
    query(collection(kuenstler, "medien"), where("original", "==", pfad), limit(1)),
    s => setMedium(s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() }),
    () => setMedium(null)), [pfad]);
  const name = pfad.split("/").pop();
  const basis = medium && `/bilder/${KUENSTLER}/${medium.id}`;
  return (
    <li className="w-28 text-xs space-y-1">
      {medium?.art === "bild" ? (
        <a href={`${basis}-${medium.breiten.at(-1)}.webp`} target="_blank" rel="noopener" title="Groß ansehen">
          <img src={`${basis}-${medium.breiten[0]}.webp`} alt={name} loading="lazy"
               className="w-28 h-28 object-contain bg-gray-100 rounded border" />
        </a>
      ) : (
        <div className="w-28 h-28 bg-gray-100 rounded border flex items-center justify-center text-center p-1 text-gray-600">
          {medium === undefined ? "" : medium === null ? "wird verarbeitet…"
            : medium.art === "video" ? "Video" : medium.art === "fehler" ? "nicht lesbar" : "nicht unterstützt"}
        </div>
      )}
      <div className="break-all" title={medium?.fehler}>{name}</div>
    </li>
  );
}
