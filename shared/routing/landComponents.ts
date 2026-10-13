import type { Pt } from "../geo";

type LandComponent = "mindoro-mainland" | "lubang-island-group";

// Conservative navigation extents for the two municipalities on the
// road-connected Lubang island group. These are routing safety guards, not
// administrative polygons and are never rendered as official boundaries.
const LUBANG_GROUP_EXTENTS: Array<[[number, number], [number, number]]> = [
  [[13.624979, 120.154361], [13.864979, 120.394361]], // Looc
  [[13.691398, 120.01846], [13.931398, 120.25846]], // Lubang
];

function within(point: Pt, bounds: [[number, number], [number, number]]): boolean {
  return point[0] >= bounds[0][0] && point[0] <= bounds[1][0]
    && point[1] >= bounds[0][1] && point[1] <= bounds[1][1];
}

export function knownLandComponent(point: Pt): LandComponent {
  return LUBANG_GROUP_EXTENTS.some((bounds) => within(point, bounds))
    ? "lubang-island-group"
    : "mindoro-mainland";
}

/** True when a road-only request crosses a known sea gap. */
export function hasKnownDisconnectedLandComponents(points: Pt[]): boolean {
  return new Set(points.map(knownLandComponent)).size > 1;
}
