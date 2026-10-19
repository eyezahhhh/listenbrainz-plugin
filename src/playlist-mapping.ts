import type {
	AttributeValue,
	SavedAttributeValues,
	SavedPlaylist,
	WritablePlaylistClient,
} from "@pipe-bomb/plugin-sdk";
import { PLAYLIST_BOT_ID } from "./const/playlist-bot-id.const.js";
import type { ListenBrainzDb } from "./db.js";
import path from "path";
import { createPlaylistCover } from "./utils.js";

export const PLUGIN_ID = "listenbrainz";
export const ATTRIBUTE_SOURCE_ID = "listenbrainz";

export type ListenBrainzPlaylistType = "loved" | "recommendations";

const PLAYLIST_TITLES: Record<ListenBrainzPlaylistType, string> = {
	loved: "ListenBrainz Likes",
	recommendations: "ListenBrainz Recommendations",
};

export function getPlaylistTitle(type: ListenBrainzPlaylistType): string {
	return PLAYLIST_TITLES[type];
}

export function buildPlaylistAttributes(
	userUuid: string,
	type: ListenBrainzPlaylistType,
	title: string,
	covers: SavedAttributeValues["buffer"][],
): AttributeValue[] {
	const attributes: AttributeValue[] = [
		{ key: "title", value: title },
		{ key: "pipebomb_user_uuid", value: userUuid },
		{ key: "listenbrainz_playlist_type", value: type },
	];

	if (covers.length) {
		const coverPath = path.join(
			"resources",
			covers[0]!.uuid.substring(0, 3),
			`${covers[0]!.uuid}.${covers[0]!.extension}`,
		);
		attributes.push({
			key: "thumb",
			value: {
				extension: "jpg",
				buffer: () => createPlaylistCover(coverPath),
			},
		});
	}

	return attributes;
}

function getStringAttribute(
	playlist: SavedPlaylist,
	key: string,
): string | undefined {
	const attribute = playlist.attributes?.find(
		(a) =>
			a.key === key &&
			a.type === "string" &&
			a.sourceId === ATTRIBUTE_SOURCE_ID,
	);
	if (!attribute) {
		return undefined;
	}
	return (attribute.values as string[])[0];
}

function parsePlaylistType(
	value: string | undefined,
): ListenBrainzPlaylistType | null {
	if (value === "loved" || value === "recommendations") {
		return value;
	}
	return null;
}

export interface DiscoveredPlaylist {
	uuid: string;
	userUuid: string | null;
	type: ListenBrainzPlaylistType | null;
}

export interface DiscoveredMappings {
	mappings: Map<string, Partial<Record<ListenBrainzPlaylistType, string>>>;
	playlists: DiscoveredPlaylist[];
}

export async function discoverPlaylistMappings(
	client: WritablePlaylistClient,
): Promise<DiscoveredMappings> {
	const mappings = new Map<
		string,
		Partial<Record<ListenBrainzPlaylistType, string>>
	>();
	const playlists: DiscoveredPlaylist[] = [];

	const uuids = await client.getBotPlaylistUuids(PLUGIN_ID, PLAYLIST_BOT_ID);

	for (const uuid of uuids) {
		const playlist = await client.getPlaylist(uuid, {
			relations: { attributes: true },
		});
		if (!playlist) {
			continue;
		}

		const userUuid = getStringAttribute(playlist, "pipebomb_user_uuid") ?? null;
		const type = parsePlaylistType(
			getStringAttribute(playlist, "listenbrainz_playlist_type"),
		);

		playlists.push({ uuid, userUuid, type });

		if (userUuid && type) {
			const entry = mappings.get(userUuid) ?? {};
			entry[type] = uuid;
			mappings.set(userUuid, entry);
		}
	}

	return { mappings, playlists };
}

export async function reconcileOrphans(
	client: WritablePlaylistClient,
	playlists: DiscoveredPlaylist[],
	activeUserUuids: Set<string>,
): Promise<void> {
	const valid = new Set<string>();

	for (const { uuid, userUuid, type } of playlists) {
		if (userUuid && type && activeUserUuids.has(userUuid)) {
			valid.add(uuid);
		}
	}

	for (const { uuid } of playlists) {
		if (!valid.has(uuid)) {
			await client.deletePlaylist(uuid);
		}
	}
}

export async function migratePlaylistMappings(
	db: ListenBrainzDb,
	client: WritablePlaylistClient,
): Promise<void> {
	if (db.isPlaylistMappingMigrated()) {
		return;
	}

	for (const user of db.getAllUsers()) {
		const legacy: Array<[ListenBrainzPlaylistType, string | null]> = [
			["loved", user.lovedPlaylist],
			["recommendations", user.recsPlaylist],
		];

		for (const [type, uuid] of legacy) {
			if (!uuid) {
				continue;
			}

			const playlist = await client.getPlaylist(uuid, {
				relations: { attributes: true },
			});
			if (!playlist) {
				continue;
			}

			await client.updatePlaylistAttributes(
				uuid,
				ATTRIBUTE_SOURCE_ID,
				buildPlaylistAttributes(
					user.userUuid,
					type,
					getPlaylistTitle(type),
					[],
				),
			);
		}
	}

	db.markPlaylistMappingMigrated();
}
