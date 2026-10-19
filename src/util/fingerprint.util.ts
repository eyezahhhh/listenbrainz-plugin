import { createHash } from "node:crypto";
import type { PlaybackHistoryEntry } from "@pipe-bomb/plugin-sdk";

export function computeFingerprint(entry: PlaybackHistoryEntry): string {
	const raw =
		entry.trackUuid +
		entry.userUuid +
		entry.datePlayed.toISOString() +
		(entry.pluginId ?? "") +
		entry.clientName;
	return createHash("sha1").update(raw).digest("hex");
}
