import React, { ReactNode } from "react";
import DashboardLayout from "../layout/DashboardLayout";

/**
 * Original DRRM admin shell — now the LGU variant of the shared
 * DashboardLayout (same sidebar look, more sections). Kept as a named
 * component so every existing admin page keeps working unchanged.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout kind="lgu">{children}</DashboardLayout>;
}
