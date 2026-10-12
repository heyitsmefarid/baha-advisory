import { describe, expect, it } from "vitest";
import { privateOfflineSnapshotKey, PUBLIC_OFFLINE_SNAPSHOT_KEY } from "../../src/lib/offlineSnapshotKeys";

describe("offline snapshot privacy", () => {
  it("uses a public key for public safety data and a UID key for contacts", () => {
    expect(PUBLIC_OFFLINE_SNAPSHOT_KEY).toBe("offline_public_snapshot_v3");
    expect(privateOfflineSnapshotKey("user-a")).toBe("offline_private_snapshot_v3:user-a");
    expect(privateOfflineSnapshotKey("user-a")).not.toBe(privateOfflineSnapshotKey("user-b"));
  });
});
