import React from "react";
import { GeoJSON as GeoJSONLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { BoundaryFeatureCollection } from "../../../shared/geography";
import { useGeographicScope } from "../../contexts/GeographicScopeContext";
import { BoundaryUnavailableError, BOUNDARY_MANIFEST, loadBoundaryAsset } from "../../lib/geographyAssets";

export default function AdministrativeBoundaryLayer() {
  const map = useMap();
  const { scope, fitBounds } = useGeographicScope();
  const [data, setData] = React.useState<BoundaryFeatureCollection | null>(null);
  const scopeKey = `${scope.provincePsgcCode ?? "island"}:${scope.municipalityPsgcCode ?? "all"}:${scope.barangayPsgcCode ?? "all"}`;

  React.useEffect(() => {
    map.flyToBounds(L.latLngBounds(fitBounds), { duration: 0.55, maxZoom: scope.barangayPsgcCode ? 15 : 12 });
  }, [fitBounds, map, scope.barangayPsgcCode, scopeKey]);

  React.useEffect(() => {
    const controller = new AbortController();
    setData(null);
    loadBoundaryAsset(scope, controller.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof BoundaryUnavailableError) return;
        console.error("Unable to load administrative boundary", error);
      });
    return () => controller.abort();
  }, [scopeKey]);

  if (!data) return null;
  return (
    <GeoJSONLayer
      key={`${BOUNDARY_MANIFEST.version}:${scopeKey}`}
      data={data as never}
      style={{ color: "#0e7490", weight: 2, opacity: 0.8, fillColor: "#0e7490", fillOpacity: 0.05 }}
    />
  );
}
