import React, { useMemo, useState } from "react";
import { childrenOf, getUnit, MINDORO_REGION_PSGC, validateCoverageScopes, type CoverageScope } from "../../../shared/geography";
import { Badge, Callout } from "../ui";

export default function CoverageScopeSelector({ value, onChange, disabled = false }: {
  value: CoverageScope[];
  onChange: (value: CoverageScope[]) => void;
  disabled?: boolean;
}) {
  const provinces = childrenOf(MINDORO_REGION_PSGC, "province");
  const [province, setProvince] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [barangay, setBarangay] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const municipalities = province ? childrenOf(province).filter((unit) => unit.level === "city" || unit.level === "municipality") : [];
  const barangays = municipality ? childrenOf(municipality, "barangay") : [];
  const validation = useMemo(() => value.length ? validateCoverageScopes(value) : { ok: false, errors: [], scopes: [] }, [value]);

  const add = () => {
    const psgcCode = barangay || municipality || province;
    const unit = getUnit(psgcCode);
    if (!unit || unit.level === "region") return;
    const level: CoverageScope["level"] = unit.level === "province" ? "province" : unit.level === "barangay" ? "barangay" : "municipality";
    const next = validateCoverageScopes([...value, { level, psgcCode }]);
    if (next.ok) { onChange(next.scopes); setAddError(null); }
    else setAddError(next.errors.join(" "));
  };

  return (
    <fieldset className="coverage-selector" disabled={disabled}>
      <legend>Paid service coverage</legend>
      {disabled ? (
        <p className="small">Coverage is fixed to the LGU's approved PSGC jurisdiction and cannot be expanded during checkout.</p>
      ) : (
        <>
          <div className="field-row">
            <label className="field"><span className="field__label">Province</span><select value={province} onChange={(e) => { setProvince(e.target.value); setMunicipality(""); setBarangay(""); }}><option value="">Choose province</option>{provinces.map((unit) => <option key={unit.psgcCode} value={unit.psgcCode}>{unit.name}</option>)}</select></label>
            <label className="field"><span className="field__label">Municipality/city</span><select value={municipality} disabled={!province} onChange={(e) => { setMunicipality(e.target.value); setBarangay(""); }}><option value="">Whole province</option>{municipalities.map((unit) => <option key={unit.psgcCode} value={unit.psgcCode}>{unit.name}</option>)}</select></label>
            <label className="field"><span className="field__label">Barangay</span><select value={barangay} disabled={!municipality} onChange={(e) => setBarangay(e.target.value)}><option value="">Whole LGU</option>{barangays.map((unit) => <option key={unit.psgcCode} value={unit.psgcCode}>{unit.name}</option>)}</select></label>
          </div>
          <button type="button" className="btn-secondary btn-sm" disabled={!province} onClick={add}>Add service area</button>
        </>
      )}
      {value.length > 0 && <div className="coverage-selector__chips" aria-label="Selected paid service areas">{value.map((scope) => <span className="coverage-selector__chip" key={`${scope.level}:${scope.psgcCode}`}><Badge tone="tide">{getUnit(scope.psgcCode)?.name ?? scope.psgcCode}</Badge>{!disabled && <button type="button" aria-label={`Remove ${getUnit(scope.psgcCode)?.name ?? scope.psgcCode}`} onClick={() => onChange(value.filter((item) => item !== scope))}>×</button>}</span>)}</div>}
      {!disabled && value.length === 0 && <p className="tiny">Choose at least one paid service area. Add both provinces for full-island commercial coverage.</p>}
      {validation.errors.length > 0 && <Callout tone="caution">{validation.errors.join(" ")}</Callout>}
      {addError && <Callout tone="caution">{addError}</Callout>}
      <p className="tiny"><strong>Always free island-wide:</strong> public maps, emergency alerts, evacuation information, community reporting, and basic navigation do not use this paid coverage.</p>
    </fieldset>
  );
}
