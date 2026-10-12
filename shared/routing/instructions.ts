/**
 * Turn-by-turn text from OSRM maneuvers (OSRM returns structured maneuvers,
 * not sentences). English and Filipino.
 */

type Lang = "en" | "fil";

const MOD_EN: Record<string, string> = {
  left: "left",
  right: "right",
  "slight left": "slightly left",
  "slight right": "slightly right",
  "sharp left": "sharp left",
  "sharp right": "sharp right",
  straight: "straight",
  uturn: "around (U-turn)",
};

const MOD_FIL: Record<string, string> = {
  left: "kumaliwa",
  right: "kumanan",
  "slight left": "bahagyang kumaliwa",
  "slight right": "bahagyang kumanan",
  "sharp left": "kumaliwa nang matalim",
  "sharp right": "kumanan nang matalim",
  straight: "dumiretso",
  uturn: "mag-U-turn",
};

const COMPASS_EN = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const COMPASS_FIL = ["hilaga", "hilagang-silangan", "silangan", "timog-silangan", "timog", "timog-kanluran", "kanluran", "hilagang-kanluran"];

function compass(bearing: number | undefined, lang: Lang): string {
  if (bearing == null) return "";
  const i = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
  return (lang === "fil" ? COMPASS_FIL : COMPASS_EN)[i];
}

function ordinal(n: number, lang: Lang): string {
  if (lang === "fil") return `ika-${n}`;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export interface ManeuverInput {
  type: string;
  modifier?: string;
  name?: string;
  bearingAfter?: number;
  exit?: number;
}

export function instructionText(m: ManeuverInput, lang: Lang = "en"): string {
  const road = m.name?.trim();
  const fil = lang === "fil";
  const onto = road ? (fil ? ` papunta sa ${road}` : ` onto ${road}`) : "";
  const mod = m.modifier ? (fil ? MOD_FIL[m.modifier] : MOD_EN[m.modifier]) ?? m.modifier : "";
  switch (m.type) {
    case "depart":
      return fil
        ? `Magsimula patungong ${compass(m.bearingAfter, lang)}${road ? ` sa ${road}` : ""}`
        : `Head ${compass(m.bearingAfter, lang)}${road ? ` on ${road}` : ""}`;
    case "arrive":
      return fil ? "Nakarating ka na sa iyong destinasyon" : "Arrive at your destination";
    case "roundabout":
    case "rotary":
      return m.exit
        ? fil
          ? `Sa rotonda, lumabas sa ${ordinal(m.exit, lang)} labasan${onto}`
          : `At the roundabout, take the ${ordinal(m.exit, lang)} exit${onto}`
        : fil
        ? `Pumasok sa rotonda${onto}`
        : `Enter the roundabout${onto}`;
    case "merge":
      return fil ? `Sumanib${onto}` : `Merge${mod ? ` ${mod}` : ""}${onto}`;
    case "on ramp":
      return fil ? `Pumasok sa ramp${onto}` : `Take the ramp${onto}`;
    case "off ramp":
      return fil ? `Lumabas sa ramp${onto}` : `Take the exit${onto}`;
    case "fork":
      return fil ? `Sa sangandaan, ${mod || "dumiretso"}${onto}` : `At the fork, keep ${mod || "straight"}${onto}`;
    case "end of road":
      return fil ? `Sa dulo ng daan, ${mod}${onto}` : `At the end of the road, turn ${mod}${onto}`;
    case "new name":
    case "continue":
      if (m.modifier === "uturn") return fil ? `Mag-U-turn${onto}` : `Make a U-turn${onto}`;
      return fil ? `Dumiretso${onto}` : `Continue${onto}`;
    case "turn":
    default:
      if (!m.modifier || m.modifier === "straight") return fil ? `Dumiretso${onto}` : `Continue straight${onto}`;
      if (m.modifier === "uturn") return fil ? `Mag-U-turn${onto}` : `Make a U-turn${onto}`;
      return fil ? `${capitalize(mod)}${onto}` : `Turn ${mod}${onto}`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
