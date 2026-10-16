import L from "leaflet";

/**
 * Inline-SVG divIcons (Leaflet's default PNG markers break under bundlers
 * and don't carry status color). Shapes encode type, color encodes status.
 */
function svgIcon(html: string, size: number, anchor: [number, number], className = "map-icon") {
  return L.divIcon({ className, html, iconSize: [size, size], iconAnchor: anchor });
}

export function pinIcon(color: string, glyph = "", size = 32) {
  return svgIcon(
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">
      <path fill="${color}" stroke="white" stroke-width="1.2" d="M12 0C6.5 0 2 4.5 2 10c0 7.5 10 14 10 14s10-6.5 10-14c0-5.5-4.5-10-10-10z"/>
      <circle cx="12" cy="10" r="5.2" fill="white"/>
      <text x="12" y="12.8" text-anchor="middle" font-size="7.5" font-weight="800" font-family="Inter,system-ui" fill="${color}">${glyph}</text>
    </svg>`,
    size,
    [size / 2, size]
  );
}

export function dotIcon(color: string, size = 16, ring = "white") {
  return svgIcon(
    `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${ring};box-shadow:0 0 0 2px ${color}55,0 1px 4px rgba(0,0,0,.4)"></span>`,
    size,
    [size / 2, size / 2]
  );
}

/** Pulsing "you are here" dot. */
export function userIcon() {
  return svgIcon(`<span class="user-dot"><span class="user-dot__pulse"></span></span>`, 22, [11, 11], "map-icon map-icon--user");
}

/** Square marker for evacuation centers (shape distinct from flood pins). */
export function shelterIcon(color: string, selected = false) {
  const s = selected ? 34 : 28;
  return svgIcon(
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="${color}" stroke="white" stroke-width="1.6"/>
      <path d="M6 12.5 12 7l6 5.5V18H6z" fill="white"/>
      <rect x="10.4" y="13.5" width="3.2" height="4.5" fill="${color}"/>
    </svg>`,
    s,
    [s / 2, s / 2]
  );
}

/** Camera badge for verified community reports. */
export function reportIcon(color = "#0e7490") {
  return svgIcon(
    `<svg width="26" height="26" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))">
      <circle cx="12" cy="12" r="10.5" fill="${color}" stroke="white" stroke-width="1.6"/>
      <rect x="6.5" y="8.5" width="11" height="8" rx="1.6" fill="white"/>
      <rect x="9.5" y="7" width="5" height="2.4" rx=".8" fill="white"/>
      <circle cx="12" cy="12.5" r="2.3" fill="${color}"/>
    </svg>`,
    26,
    [13, 13]
  );
}

/** Water-level station gauge marker. */
export function stationIcon(color: string) {
  return svgIcon(
    `<svg width="24" height="28" viewBox="0 0 20 24" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))">
      <rect x="6" y="1" width="8" height="22" rx="2" fill="white" stroke="${color}" stroke-width="2"/>
      <rect x="8" y="11" width="4" height="10" fill="${color}"/>
      <path d="M8 5h3M8 8h4M8 11h3" stroke="${color}" stroke-width="1.2"/>
    </svg>`,
    24,
    [12, 26]
  );
}

export function sosIcon() {
  return svgIcon(
    `<span class="sos-marker">SOS</span>`,
    40,
    [20, 20],
    "map-icon map-icon--sos"
  );
}
