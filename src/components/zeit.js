/**
 * Ein Zeitpunkt (Firestore-Timestamp) in der Zeitzone des Browsers, mit ihrem
 * Kürzel, damit klar ist, welche gemeint ist (#205): „29.10.26, 20:14 MEZ“.
 */
export const wann = (t, ersatz = "…") => t ? t.toDate().toLocaleString("de-DE", {
  day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
}) : ersatz;
