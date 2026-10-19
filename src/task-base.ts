import type {
	LibraryHandlerId,
	PlaybackHistoryEntry,
	SavedArtist,
	TaskRunContext,
} from "@pipe-bomb/plugin-sdk";
import { getStringAttr } from "./util/attribute.util.js";
import type { ListenPayload } from "./types/listen.interface.js";
import type { ListenBrainzContext, MbIndexTrack } from "./types/task.interface.js";
import type { ListenBrainzUser } from "./types/user.interface.js";

export abstract class ListenBrainzTask {
	constructor(protected readonly deps: ListenBrainzContext) {}

	protected async forEachLibraryTrack(
		callback: (
			ref: LibraryHandlerId & { trackId: string },
			trackUuid: string,
		) => void | Promise<void>,
	): Promise<void> {
		for (const lib of this.deps.dataClient.getLibraryHandlerIds()) {
			await this.deps.dataClient.forEachTrackId(
				lib.pluginId,
				lib.libraryId,
				(trackId, trackUuid) =>
					callback(
						{
							pluginId: lib.pluginId,
							libraryId: lib.libraryId,
							trackId,
						},
						trackUuid,
					),
			);
		}
	}

	protected async forEachActiveUser(
		context: TaskRunContext,
		users: ListenBrainzUser[],
		isEnabled: (userUuid: string) => Promise<boolean>,
		callback: (user: ListenBrainzUser, token: string) => Promise<void>,
	): Promise<void> {
		let processed = 0;

		for (const user of users) {
			const token = await this.deps.userConfig.getToken(user.userUuid);
			const enabled = token ? await isEnabled(user.userUuid) : false;

			if (token && enabled) {
				await callback(user, token);
			}

			processed++;
			context.update(users.length ? processed / users.length : 1);
		}
	}

	protected async buildTrackIndex(): Promise<
		Map<string, LibraryHandlerId & { trackId: string }>
	> {
		const index = new Map<string, LibraryHandlerId & { trackId: string }>();

		await this.forEachLibraryTrack((ref, trackUuid) => {
			index.set(trackUuid, ref);
		});

		return index;
	}

	protected async buildMbidIndex(): Promise<Map<string, MbIndexTrack>> {
		const index = new Map<string, MbIndexTrack>();

		await this.forEachLibraryTrack(async (ref) => {
			const track = await this.deps.dataClient.getTrack(
				ref.pluginId,
				ref.libraryId,
				ref.trackId,
				{
					relations: { identities: true, attributes: true },
				},
			);
			if (!track) {
				return;
			}

			for (const identity of track.identities ?? []) {
				if (identity.identityId === "musicbrainz_recording_id") {
					index.set(identity.identity, {
						uuid: track.uuid,
						attributes: track.attributes ?? [],
					});
				}
			}
		});

		return index;
	}

	protected async buildListenPayload(
		entry: PlaybackHistoryEntry,
		trackRef: LibraryHandlerId & { trackId: string },
	): Promise<ListenPayload | null> {
		const savedTrack = await this.deps.dataClient.getTrack(
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

	dispose(): void {}
}
