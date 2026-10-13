export const PUBLIC_OFFLINE_SNAPSHOT_KEY = "offline_public_snapshot_v3";

export function privateOfflineSnapshotKey(uid: string): string {
  return `offline_private_snapshot_v3:${uid}`;
}
