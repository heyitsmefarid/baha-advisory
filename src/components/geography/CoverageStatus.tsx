import React from "react";
import type { BoundaryStatus } from "../../../shared/geography";

const LABELS: Record<BoundaryStatus, string> = {
  authoritative: "Verified government boundary",
  approximate_official: "Approximate government boundary",
  unavailable: "Boundary outline unavailable",
};

export default function CoverageStatus({ status }: { status: BoundaryStatus }) {
  return (
    <span className={`coverage-status coverage-status--${status}`}>
      <span aria-hidden="true" className="coverage-status__dot" />
      PSGC navigation ready · {LABELS[status]}
    </span>
  );
}

