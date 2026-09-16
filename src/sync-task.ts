import type {
	DataClient,
	LibraryHandlerId,
	PlaybackHistoryClient,
	PlaybackHistoryEntry,
	PlaylistClient,
	SavedArtist,
	SavedAttribute,
	SubTask,
	TaskRunContext,
} from "@pipe-bomb/plugin-sdk";
import { createHash } from "node:crypto";
import { type ListenBrainzApi, type ListenPayload } from "./api.js";
import { type ListenBrainzDb } from "./db.js";
import { type ListenBrainzUserConfig } from "./user-config.js";

type ListensSubTask = "all" | "new";
type PlaylistsSubTask = "loved-tracks" | "recommendations";

function computeFingerprint(entry: PlaybackHistoryEntry): string {
	const raw =
		entry.trackUuid +
		entry.userUuid +
		entry.datePlayed.toISOString() +
		(entry.pluginId ?? "") +
		entry.clientName;
	return createHash("sha1").update(raw).digest("hex");
}

function getStringAttr(
	attrs: SavedAttribute[] | null | undefined,
	key: string,
): string | undefined {
	const attr = attrs?.find((a) => a.key === key && a.type === "string");
	if (!attr) {
		return undefined;
	}
	return (attr.values as string[])[0];
}

async function buildTrackIndex(
	dataClient: DataClient,
): Promise<Map<string, LibraryHandlerId & { trackId: string }>> {
	const index = new Map<string, LibraryHandlerId & { trackId: string }>();
	const libraryIds = dataClient.getLibraryHandlerIds();
	for (const lib of libraryIds) {
		await dataClient.forEachTrackId(
			lib.pluginId,
			lib.libraryId,
			(trackId, trackUuid) => {
				index.set(trackUuid, {
					pluginId: lib.pluginId,
					libraryId: lib.libraryId,
					trackId,
				});
			},
		);
	}
	return index;
}

async function buildMbidIndex(
	dataClient: DataClient,
): Promise<Map<string, string>> {
	const mbidToUuid = new Map<string, string>();
	const libraryIds = dataClient.getLibraryHandlerIds();
	for (const lib of libraryIds) {
		await dataClient.forEachTrackId(
			lib.pluginId,
			lib.libraryId,
			async (trackId) => {
				const track = await dataClient.getTrack(
					lib.pluginId,
					lib.libraryId,
					trackId,
					{
						relations: { identities: true },
					},
				);
				if (!track) {
					return;
				}
				for (const identity of track.identities ?? []) {
					if (identity.identityId === "musicbrainz_recording_id") {
						mbidToUuid.set(identity.identity, track.uuid);
					}
				}
			},
		);
	}
	return mbidToUuid;
}

async function buildListenPayload(
	entry: PlaybackHistoryEntry,
	trackRef: LibraryHandlerId & { trackId: string },
	dataClient: DataClient,
): Promise<ListenPayload | null> {
	const savedTrack = await dataClient.getTrack(
		trackRef.pluginId,
		trackRef.libraryId,
		trackRef.trackId,
		{
			relations: {
				attributes: true,
				artists: { attributes: true },
				albums: { attributes: true },
				identities: true,
			},
		},
	);

	if (!savedTrack) {
		return null;
	}

	const artistNames: string[] = [];
	for (const artistTrack of savedTrack.artists ?? []) {
		const name = getStringAttr(
			(artistTrack.artist as SavedArtist).attributes,
			"name",
		);
		if (name) {
			artistNames.push(name);
		}
	}
	const artistName =
		artistNames.length > 0 ? artistNames.join(", ") : "Unknown Artist";

	let releaseName: string | undefined;
	const firstAlbum = (savedTrack.albums ?? [])[0];
	if (firstAlbum?.album) {
		releaseName = getStringAttr(firstAlbum.album.attributes, "title");
	}

	const payload: ListenPayload = {
		listenedAt: Math.floor(entry.datePlayed.getTime() / 1000),
		trackName: savedTrack.title,
		artistName,
	};

	if (releaseName !== undefined) {
		payload.releaseName = releaseName;
	}

	const recordingMbid = savedTrack.identities?.find(
		(i) => i.identityId === "musicbrainz_recording_id",
	)?.identity;
	if (recordingMbid !== undefined) {
		payload.recordingMbid = recordingMbid;
	}

	return payload;
}

async function upsertPlaylist(
	playlistClient: PlaylistClient,
	existingUuid: string | null,
	userUuid: string,
	title: string,
	trackUuids: string[],
): Promise<string> {
	let uuid = existingUuid;
	if (!uuid) {
		uuid = await playlistClient.createPlaylist({
			attributes: {
				sourceId: "listenbrainz",
				attributes: [{ key: "title", value: title }],
			},
		});
		await playlistClient.addPlaylistMember(uuid, userUuid, "viewer");
	} else {
		await playlistClient.updatePlaylistAttributes(uuid, "listenbrainz", [
			{ key: "title", value: title },
		]);
	}

	const playlist = await playlistClient.getPlaylist(uuid, {
		relations: { tracks: true },
	});
	const currentUuids = new Set(
		(playlist?.tracks ?? []).map((t) => t.trackUuid),
	);
	const newUuids = new Set(trackUuids);

	const toAdd = trackUuids.filter((u) => !currentUuids.has(u));
	const toRemove = [...currentUuids].filter((u) => !newUuids.has(u));

	if (toAdd.length > 0) {
		await playlistClient.addToPlaylist(uuid, toAdd);
	}
	if (toRemove.length > 0) {
		await playlistClient.removeFromPlaylist(uuid, toRemove);
	}

	return uuid;
}

export class ListensTask implements SubTask<ListensSubTask> {
	readonly id = "upload-listens";
	readonly resumable = false;

	constructor(
		private readonly api: ListenBrainzApi,
		private readonly db: ListenBrainzDb,
		private readonly userConfig: ListenBrainzUserConfig,
		private readonly historyClient: PlaybackHistoryClient,
		private readonly dataClient: DataClient,
	) {}

	getSubTasks(): readonly ListensSubTask[] {
		return ["all", "new"];
	}

	async run(context: TaskRunContext, subTaskId: ListensSubTask): Promise<void> {
		if (subTaskId === "all") {
			await this.runImport(context);
		} else if (subTaskId === "new") {
			await this.runScrobbles(context);
		}
	}

	private async runImport(context: TaskRunContext): Promise<void> {
		const trackIndex = await buildTrackIndex(this.dataClient);
		const users = this.db.getAllUsers();
		let usersProcessed = 0;

		for (const user of users) {
			const token = await this.userConfig.getToken(user.userUuid);
			if (!token) {
				usersProcessed++;
				context.update(Math.floor((usersProcessed / users.length) * 100));
				continue;
			}

			const enabled = await this.userConfig.isScrobbleEnabled(user.userUuid);
			if (!enabled) {
				usersProcessed++;
				context.update(Math.floor((usersProcessed / users.length) * 100));
				continue;
			}

			let offset = 0;
			let pendingPayloads: ListenPayload[] = [];
			const allFingerprints: Array<{
				fingerprint: string;
				userUuid: string;
				datePlayed: number;
				dateRecorded: number;
			}> = [];

			const submitBatch = async () => {
				if (pendingPayloads.length === 0) {
					return;
				}
				await this.api.submitListens(token, pendingPayloads, "import");
				pendingPayloads = [];
			};

			while (true) {
				const result = await this.historyClient.getUserHistory(user.userUuid, {
					amount: 100,
					offset,
				});

				if (result.entries.length === 0) {
					break;
				}

				for (const entry of result.entries) {
					const fp = computeFingerprint(entry);

					const trackRef = trackIndex.get(entry.trackUuid);
					if (!trackRef) {
						continue;
					}

					const payload = await buildListenPayload(
						entry,
						trackRef,
						this.dataClient,
					);
					if (!payload) {
						continue;
					}

					pendingPayloads.push(payload);
					allFingerprints.push({
						fingerprint: fp,
						userUuid: user.userUuid,
						datePlayed: entry.datePlayed.getTime(),
						dateRecorded: entry.dateRecorded.getTime(),
					});

					if (pendingPayloads.length >= 1000) {
						await submitBatch();
					}
				}

				offset += result.entries.length;
			}

			await submitBatch();

			this.db.clearFingerprints(user.userUuid);
			this.db.insertFingerprints(allFingerprints);

			usersProcessed++;
			context.update(Math.floor((usersProcessed / users.length) * 100));
		}

		context.update(100);
	}

	private async runScrobbles(_context: TaskRunContext): Promise<void> {
		const trackIndex = await buildTrackIndex(this.dataClient);
		const users = this.db.getAllUsers();

		for (const user of users) {
			const token = await this.userConfig.getToken(user.userUuid);
			if (!token) {
				continue;
			}

			const enabled = await this.userConfig.isScrobbleEnabled(user.userUuid);
			if (!enabled) {
				continue;
			}

			let offset = 0;
			let pendingListens: Array<{
				payload: ListenPayload;
				fingerprint: string;
				dbEntry: {
					fingerprint: string;
					userUuid: string;
					datePlayed: number;
					dateRecorded: number;
				};
			}> = [];

			const submitBatch = async () => {
				if (pendingListens.length === 0) {
					return;
				}

				const payloads = pendingListens.map((p) => p.payload);
				const dbEntries = pendingListens.map((p) => p.dbEntry);

				await this.api.submitListens(token, payloads, "import");
				this.db.insertFingerprints(dbEntries);

				pendingListens = [];
			};

			while (true) {
				const result = await this.historyClient.getUserHistory(user.userUuid, {
					amount: 100,
					offset,
				});

				if (result.entries.length === 0) {
					break;
				}

				for (const entry of result.entries) {
					const fp = computeFingerprint(entry);

					if (this.db.hasFingerprint(fp)) {
						continue;
					}

					const trackRef = trackIndex.get(entry.trackUuid);
					if (!trackRef) {
						continue;
					}

					const payload = await buildListenPayload(
						entry,
						trackRef,
						this.dataClient,
					);
					if (!payload) {
						continue;
					}

					pendingListens.push({
						payload,
						fingerprint: fp,
						dbEntry: {
							fingerprint: fp,
							userUuid: user.userUuid,
							datePlayed: entry.datePlayed.getTime(),
							dateRecorded: entry.dateRecorded.getTime(),
						},
					});

					if (pendingListens.length >= 1000) {
						await submitBatch();
					}
				}

				offset += result.entries.length;
			}

			await submitBatch();
		}
	}
}

export class PlaylistsTask implements SubTask<PlaylistsSubTask> {
	readonly id = "create-playlists";
	readonly resumable = false;

	constructor(
		private readonly api: ListenBrainzApi,
		private readonly db: ListenBrainzDb,
		private readonly userConfig: ListenBrainzUserConfig,
		private readonly dataClient: DataClient,
		private readonly playlistClient: PlaylistClient,
	) {}

	getSubTasks(): readonly PlaylistsSubTask[] {
		return ["loved-tracks", "recommendations"];
	}

	async run(
		context: TaskRunContext,
		subTaskId: PlaylistsSubTask,
	): Promise<void> {
		if (subTaskId === "loved-tracks") {
			await this.runLovedTracks(context);
		} else if (subTaskId === "recommendations") {
			await this.runRecommendations(context);
		}
	}

	private async runLovedTracks(_context: TaskRunContext): Promise<void> {
		const mbidIndex = await buildMbidIndex(this.dataClient);
		const users = this.db.getAllUsers();

		for (const user of users) {
			const token = await this.userConfig.getToken(user.userUuid);
			if (!token) {
				continue;
			}

			const enabled = await this.userConfig.isLovedEnabled(user.userUuid);
			if (!enabled) {
				continue;
			}

			const loved = await this.api.getLovedTracks(user.lbUsername);

			const resolvedUuids: string[] = [];
			for (const item of loved) {
				const trackUuid = mbidIndex.get(item.mbid);
				if (trackUuid) {
					resolvedUuids.push(trackUuid);
				}
			}

			const newUuid = await upsertPlaylist(
				this.playlistClient,
				user.lovedPlaylist,
				user.userUuid,
				"ListenBrainz Likes",
				resolvedUuids,
			);

			if (user.lovedPlaylist !== newUuid) {
				this.db.setLovedPlaylist(user.userUuid, newUuid);
			}
		}
	}

	private async runRecommendations(_context: TaskRunContext): Promise<void> {
		const mbidIndex = await buildMbidIndex(this.dataClient);
		const users = this.db.getAllUsers();

		for (const user of users) {
			const token = await this.userConfig.getToken(user.userUuid);
			if (!token) {
				continue;
			}

			const enabled = await this.userConfig.isRecsEnabled(user.userUuid);
			if (!enabled) {
				continue;
			}

			const recs = await this.api.getRecommendations(user.lbUsername);

			const resolvedUuids: string[] = [];
			for (const item of recs) {
				const trackUuid = mbidIndex.get(item.mbid);
				if (trackUuid) {
					resolvedUuids.push(trackUuid);
				}
			}

			const newUuid = await upsertPlaylist(
				this.playlistClient,
				user.recsPlaylist,
				user.userUuid,
				"ListenBrainz Recommendations",
				resolvedUuids,
			);

			if (user.recsPlaylist !== newUuid) {
				this.db.setRecsPlaylist(user.userUuid, newUuid);
			}
		}
	}
}
