// Der Herzberg-Schriftzug.
//
// Eingebunden als Maske, nicht als Bild: Die Vorlage ist eine weiße Silhouette
// auf durchsichtigem Grund und wäre auf hellem Untergrund unsichtbar. Als Maske
// nimmt sie die Farbe ihrer Umgebung an und sitzt damit in heller wie dunkler
// Darstellung richtig.

export function Logo({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      className={className ? `logo ${className}` : "logo"}
      role={label ? "img" : "presentation"}
      aria-label={label}
    />
  );
}
