// Symbole für den Einstiegs-Guide. Bewusst als Strichzeichnungen in
// currentColor: sie nehmen die Farbe ihrer Umgebung an und bleiben in beiden
// Darstellungen lesbar.

type Props = { className?: string };

const base = {
  width: 24, height: 24, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Teilen-Symbol von iOS: Rechteck mit Pfeil nach oben. */
export const Share = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 3v12" />
    <path d="M8 7l4-4 4 4" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
);

/** Zum Home-Bildschirm: Quadrat mit Plus. */
export const AddToHome = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

/** Android-Menü: drei Punkte. */
export const Menu = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const Install = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 3v10" />
    <path d="M8 9l4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

export const Camera = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h7.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.4" />
  </svg>
);

export const Lock = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

/** Suchrahmen des Scanners: vier Ecken. */
export const Scan = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
    <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
    <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
    <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
    <path d="M7 12h10" />
  </svg>
);

export const Keypad = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" strokeWidth="2.4" />
  </svg>
);

export const Check = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M4 12.5l5.2 5.2L20 7" strokeWidth="2.2" />
  </svg>
);

export const Wifi = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M2.5 9a15 15 0 0 1 19 0" />
    <path d="M6 12.5a10 10 0 0 1 12 0" />
    <path d="M9.5 16a5 5 0 0 1 5 0" />
    <circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const Fullscreen = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
    <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  </svg>
);

export const Tear = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M6 3h12a1 1 0 0 1 1 1v6H5V4a1 1 0 0 1 1-1z" />
    <path d="M3 12.5h2M7 12.5h2M11 12.5h2M15 12.5h2M19 12.5h2" />
    <path d="M5 15h14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
  </svg>
);

export const Safari = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" opacity=".85" />
  </svg>
);

export const Warning = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 4.5l8.5 15h-17z" />
    <path d="M12 10v4M12 17h.01" strokeWidth="2" />
  </svg>
);

export const Eye = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOff = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M9.9 5.7A10.6 10.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a18 18 0 0 1-3.3 4.1" />
    <path d="M6.3 7.8A17.6 17.6 0 0 0 2 12s3.6 6.5 10 6.5a10.9 10.9 0 0 0 4-.75" />
    <path d="M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8" />
    <path d="M3 3l18 18" />
  </svg>
);
