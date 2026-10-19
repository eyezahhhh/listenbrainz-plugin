import type {
	SavedAttributeValues,
	SubTask,
	TaskRunContext,
} from "@pipe-bomb/plugin-sdk";
import type { SearchAttribute } from "ephemeral-import/src/attribute-entry.js";
import type { SearchClient } from "ephemeral-import/src/search-client.js";
import {
	ATTRIBUTE_SOURCE_ID,
	buildPlaylistAttributes,
	discoverPlaylistMappings,
	getPlaylistTitle,
	migratePlaylistMappings,
	reconcileOrphans,
} from "./playlist-mapping.js";
import { ListenBrainzTask } from "./task-base.js";
import { computeFingerprint } from "./util/fingerprint.util.js";
import { createPlaylistCover, COVER_COLLAGE_SIZE } from "./util/cover.util.js";
import type {
	FingerprintEntry,
	PendingListen,
	RecordingMetadata,
} from "./types/listen.interface.js";
import type {
	DiscoveredMappings,
	ListenBrainzPlaylistType,
} from "./types/playlist.interface.js";
import type {
	ListenBrainzContext,
	ListensSubTask,
	MbIndexTrack,
	PlaylistsSubTask,
} from "./types/task.interface.js";
import type { ListenBrainzUser } from "./types/user.interface.js";

export class ListensTask extends ListenBrainzTask implements SubTask<ListensSubTask> {
	readonly id = "upload-listens";
	readonly resumable = false;

	getSubTasks(): readonly ListensSubTask[] {
		return ["all", "new"];
	}

	async run(context: TaskRunContext, subTaskId: ListensSubTask): Promise<void> {
		await this.upload(context, subTaskId);
	}

	private async upload(
		context: TaskRunContext,
		mode: ListensSubTask,
	): Promise<void> {
		const trackIndex = await this.buildTrackIndex();
		const users = this.deps.db.getAllUsers();
		const skipExisting = mode === "new";

		await this.forEachActiveUser(
			context,
			users,
			(userUuid) => this.deps.userConfig.isScrobbleEnabled(userUuid),
			async (user, token) => {
				let offset = 0;
				let pending: PendingListen[] = [];
				const allFingerprints: FingerprintEntry[] = [];

				const flush = async () => {
					if (!pending.length) {
						return;
					}

					await this.deps.api.submitListens(
						token,
						pending.map((item) => item.payload),
						"import",
					);

					if (skipExisting) {
						this.deps.db.insertFingerprints(
							pending.map((item) => item.entry),
						);
					}

					pending = [];
				};

				while (true) {
					const result = await this.deps.historyClient.getUserHistory(
						user.userUuid,
						{ amount: 100, offset },
					);

					if (result.entries.length === 0) {
						break;
					}

					for (const historyEntry of result.entries) {
						const fingerprint = computeFingerprint(historyEntry);

						if (skipExisting && this.deps.db.hasFingerprint(fingerprint)) {
							continue;
						}

						const trackRef = trackIndex.get(historyEntry.trackUuid);
						if (!trackRef) {
							continue;
						}

						const payload = await this.buildListenPayload(
							historyEntry,
							trackRef,
						);
						if (!payload) {
							continue;
						}

						const entry: FingerprintEntry = {
							fingerprint,
							userUuid: user.userUuid,
							datePlayed: historyEntry.datePlayed.getTime(),
							dateRecorded: historyEntry.dateRecorded.getTime(),
						};

						if (!skipExisting) {
							allFingerprints.push(entry);
						}

						pending.push({ payload, entry });

						if (pending.length >= 1000) {
							await flush();
						}
					}

					offset += result.entries.length;
				}

				await flush();

				if (!skipExisting) {
					this.deps.db.clearFingerprints(user.userUuid);
					this.deps.db.insertFingerprints(allFingerprints);
				}
			},
		);
	}
}

abstract class PlaylistSyncTask extends ListenBrainzTask {
	abstract readonly type: ListenBrainzPlaylistType;

	protected abstract isEnabled(userUuid: string): Promise<boolean>;

	protected abstract fetchMbids(username: string): Promise<Array<{ mbid: string }>>;

	async sync(
		context: TaskRunContext,
		users: ListenBrainzUser[],
		mappings: DiscoveredMappings["mappings"],
		mbidIndex: Map<string, MbIndexTrack>,
	): Promise<void> {
		const searchClient = await this.deps.getSearchClient();

		await this.forEachActiveUser(
			context,
			users,
			(userUuid) => this.isEnabled(userUuid),
			async (user) => {
				const items = await this.fetchMbids(user.lbUsername);
				const { uuids, covers } = await this.resolveTracks(
					mbidIndex,
					items,
					searchClient,
				);

				await this.upsertPlaylist(
					mappings.get(user.userUuid)?.[this.type] ?? null,
					user.userUuid,
					uuids,
					covers,
				);
			},
		);
	}

	private async resolveTracks(
		index: Map<string, MbIndexTrack>,
		items: Array<{ mbid: string }>,
		searchClient: SearchClient | null,
	): Promise<{
		uuids: string[];
		covers: SavedAttributeValues["buffer"][];
	}> {
		const uuids: string[] = [];
		const covers: SavedAttributeValues["buffer"][] = [];
		const misses: string[] = [];

		for (const item of items) {
			const track = index.get(item.mbid);
			if (!track) {
				misses.push(item.mbid);
				continue;
			}

			if (!uuids.includes(track.uuid)) {
				uuids.push(track.uuid);
			}

			for (const attribute of track.attributes) {
				if (
					attribute.key === "front" &&
					attribute.type === "buffer" &&
					attribute.values.length
				) {
					covers.push(attribute.values[0]!);
				}
			}
		}

		if (searchClient && misses.length) {
			const found = await this.findTracksViaSearch(searchClient, misses);
			for (const uuid of found) {
				if (!uuids.includes(uuid)) {
					uuids.push(uuid);
				}
			}
		}

		return { uuids, covers };
	}

	private buildSearchAttributes(metadata: RecordingMetadata): SearchAttribute[] {
		const attributes: SearchAttribute[] = [];

		if (metadata.isrcs.length > 0) {
			attributes.push({ key: "isrc", type: "string", value: metadata.isrcs[0]! });
		}
		if (metadata.durationSeconds !== null) {
			attributes.push({
				key: "duration",
				type: "decimal",
				value: metadata.durationSeconds,
			});
		}

		return attributes;
	}

	private async findTracksViaSearch(
		searchClient: SearchClient,
		mbids: string[],
	): Promise<string[]> {
		const metadata = await this.deps.api.getRecordingMetadata(mbids);
		const uuids: string[] = [];

		for (const mbid of mbids) {
			const track = metadata.get(mbid);
			if (!track) {
				continue;
			}

			const result = await searchClient.findTrack({
				title: track.title,
				artists: track.artistNames.map((name) => [
					{ key: "name", type: "string" as const, value: name },
				]),
				album: track.releaseName
					? [{ key: "title", type: "string" as const, value: track.releaseName }]
					: undefined,
				attributes: this.buildSearchAttributes(track),
			});

			if (!result) {
				continue;
			}

			const uuid = result.ephemeral
				? await this.deps.dataClient.saveTrack(
						{
							pluginId: result.source.pluginId,
							libraryId: result.source.source.getLibraryHandler().id,
							trackId: result.track.id,
						},
						null,
					)
				: result.track.uuid;

			if (uuid && !uuids.includes(uuid)) {
				uuids.push(uuid);
			}
		}

		return uuids;
	}

	private buildCover(
		covers: SavedAttributeValues["buffer"][],
	): (() => Promise<Buffer>) | undefined {
		const unique = new Map<string, SavedAttributeValues["buffer"]>();
		for (const cover of covers) {
			if (!unique.has(cover.uuid)) {
				unique.set(cover.uuid, cover);
			}
		}

		const all = [...unique.values()];
		if (!all.length) {
			return undefined;
		}

		const selected =
			all.length >= COVER_COLLAGE_SIZE
				? all.slice(0, COVER_COLLAGE_SIZE)
				: all.slice(0, 1);

		return async () => {
			const buffers: Buffer[] = [];
			for (const cover of selected) {
				const resource = await this.deps.dataClient.getResource(
					cover.uuid,
					cover.extension,
				);
				if (resource) {
					buffers.push(resource);
				}
			}

			if (!buffers.length) {
				throw new Error("No cover resources could be read");
			}

			return createPlaylistCover(buffers);
		};
	}

	private async upsertPlaylist(
		existingUuid: string | null,
		userUuid: string,
		trackUuids: string[],
		covers: SavedAttributeValues["buffer"][],
	): Promise<string> {
		const attributes = buildPlaylistAttributes(
			userUuid,
			this.type,
			getPlaylistTitle(this.type),
			this.buildCover(covers),
		);

		let uuid = existingUuid;
		if (!uuid) {
			uuid = await this.deps.playlistClient.createPlaylist({
				attributes: {
					sourceId: ATTRIBUTE_SOURCE_ID,
					attributes,
				},
			});
			await this.deps.playlistClient.addPlaylistMember(
				uuid,
				userUuid,
				"viewer",
			);
		} else {
			await this.deps.playlistClient.updatePlaylistAttributes(
				uuid,
				ATTRIBUTE_SOURCE_ID,
				attributes,
			);
		}

		const playlist = await this.deps.playlistClient.getPlaylist(uuid, {
			relations: { tracks: true },
		});
		const currentUuids = new Set(
			(playlist?.tracks ?? []).map((track) => track.trackUuid),
		);
		const newUuids = new Set(trackUuids);

		const toAdd = trackUuids.filter((u) => !currentUuids.has(u));
		const toRemove = [...currentUuids].filter((u) => !newUuids.has(u));

		if (toAdd.length > 0) {
			await this.deps.playlistClient.addToPlaylist(uuid, toAdd);
		}
		if (toRemove.length > 0) {
			await this.deps.playlistClient.removeFromPlaylist(uuid, toRemove);
		}

		return uuid;
	}
}

class LovedTracksTask extends PlaylistSyncTask {
	readonly type = "loved";

	protected isEnabled(userUuid: string): Promise<boolean> {
		return this.deps.userConfig.isLovedEnabled(userUuid);
	}

	protected fetchMbids(username: string): Promise<Array<{ mbid: string }>> {
		return this.deps.api.getLovedTracks(username);
	}
}

class RecommendationsTask extends PlaylistSyncTask {
	readonly type = "recommendations";

	protected isEnabled(userUuid: string): Promise<boolean> {
		return this.deps.userConfig.isRecsEnabled(userUuid);
	}

	protected fetchMbids(username: string): Promise<Array<{ mbid: string }>> {
		return this.deps.api.getRecommendations(username);
	}
}

export class PlaylistsTask
	extends ListenBrainzTask
	implements SubTask<PlaylistsSubTask>
{
	readonly id = "create-playlists";
	readonly resumable = false;

	private migrated = false;
	private readonly syncers: Record<PlaylistsSubTask, PlaylistSyncTask>;

	constructor(deps: ListenBrainzContext) {
		super(deps);
		this.syncers = {
			"loved-tracks": new LovedTracksTask(deps),
			recommendations: new RecommendationsTask(deps),
		};
	}

	getSubTasks(): readonly PlaylistsSubTask[] {
		return ["loved-tracks", "recommendations"];
	}

	async run(
		context: TaskRunContext,
		subTaskId: PlaylistsSubTask,
	): Promise<void> {
		await this.ensureMigrated();

		const users = this.deps.db.getAllUsers();
		const { mappings, playlists } = await discoverPlaylistMappings(
			this.deps.playlistClient,
		);
		const mbidIndex = await this.buildMbidIndex();

		await this.syncers[subTaskId].sync(context, users, mappings, mbidIndex);

		await reconcileOrphans(
			this.deps.playlistClient,
			playlists,
			new Set(users.map((user) => user.userUuid)),
		);
	}

	private async ensureMigrated(): Promise<void> {
		if (this.migrated) {
			return;
		}

		await migratePlaylistMappings(this.deps.db, this.deps.playlistClient);
		this.migrated = true;
	}

	override dispose(): void {
		this.migrated = false;
	}
}
