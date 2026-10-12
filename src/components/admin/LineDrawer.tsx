import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

/**
 * Leaflet.draw polyline tool for tracing an affected road segment
 * (companion to PolygonDrawer). Only one line is kept at a time.
 */
export default function LineDrawer({ onDrawn }: { onDrawn: (points: [number, number][]) => void }) {
  const map = useMap();
  const groupRef = useRef<L.FeatureGroup>(new L.FeatureGroup());

  useEffect(() => {
    const group = groupRef.current;
    map.addLayer(group);
    const control = new (L.Control as any).Draw({
      draw: {
        polyline: { shapeOptions: { color: "#d64545", weight: 6 } },
        polygon: false,
        marker: false,
        circle: false,
        circlemarker: false,
        rectangle: false,
      },
      edit: { featureGroup: group, remove: true },
    });
    map.addControl(control);
    const created = (e: any) => {
      group.clearLayers();
      group.addLayer(e.layer);
      onDrawn((e.layer.getLatLngs() as L.LatLng[]).map((ll) => [ll.lat, ll.lng] as [number, number]));
    };
    const edited = (e: any) => {
      e.layers.eachLayer((layer: any) => onDrawn((layer.getLatLngs() as L.LatLng[]).map((ll) => [ll.lat, ll.lng] as [number, number])));
    };
    map.on(L.Draw.Event.CREATED, created);
    map.on(L.Draw.Event.EDITED, edited);
    return () => {
      map.off(L.Draw.Event.CREATED, created);
      map.off(L.Draw.Event.EDITED, edited);
      map.removeControl(control);
      map.removeLayer(group);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}
