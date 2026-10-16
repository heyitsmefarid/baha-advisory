// Core flood domain types now live in /shared so the backend (server/)
// and the browser use the exact same definitions. Re-exported here so
// every existing `../types` import keeps working unchanged.
export * from "../../shared/flood";
export * from "../../shared/types";
