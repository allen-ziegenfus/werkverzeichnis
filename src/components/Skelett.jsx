/**
 * Platzhalter, solange noch nichts geladen ist (#107): graue Zeilen in etwa der
 * Form des Inhalts, damit die Seite nicht leer aussieht.
 */
export default function Skelett({ zeilen = 5, className = "" }) {
  return (
    <div role="status" className={`space-y-2 ${className}`}>
      <span className="sr-only">Lädt…</span>
      {Array.from({ length: zeilen }, (_, i) => (
        <div key={i} aria-hidden="true"
             className="h-6 rounded bg-gray-200 animate-pulse motion-reduce:animate-none"
             style={{ width: `${100 - (i * 37) % 45}%` }} />
      ))}
    </div>
  );
}
