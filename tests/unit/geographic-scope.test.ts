import { describe, expect, it } from "vitest";
import {
  parseGeographicScope,
  scopeToSearchParams,
} from "../../src/contexts/GeographicScopeContext";

const oriental = "1705200000";
const calapan = "1705205000";
const calapanBarangay = "1705205001";
const mamburao = "1705106000";

describe("URL geographic scope", () => {
  it("drops cross-province children while retaining the valid province", () => {
    const query = new URLSearchParams({
      province: oriental,
      municipality: mamburao,
      barangay: calapanBarangay,
      layer: "alerts",
    });

    expect(parseGeographicScope(query)).toEqual({
      provincePsgcCode: oriental,
      municipalityPsgcCode: null,
      barangayPsgcCode: null,
    });
  });

  it("round-trips a valid barangay scope", () => {
    const scope = {
      provincePsgcCode: oriental,
      municipalityPsgcCode: calapan,
      barangayPsgcCode: calapanBarangay,
    };

    expect(parseGeographicScope(scopeToSearchParams(scope))).toEqual(scope);
  });

  it("changes only geographic query parameters", () => {
    const current = new URLSearchParams({ layer: "roads", municipality: mamburao });
    const next = scopeToSearchParams(
      { provincePsgcCode: oriental, municipalityPsgcCode: calapan, barangayPsgcCode: null },
      current,
    );

    expect(next.toString()).toBe(`layer=roads&province=${oriental}&municipality=${calapan}`);
  });
});
