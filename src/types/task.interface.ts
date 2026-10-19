import type {
	DataClient,
	PlaybackHistoryClient,
	SavedAttribute,
	WritablePlaylistClient,
} from "@pipe-bomb/plugin-sdk";
import type { SearchClient } from "ephemeral-import/src/search-client.js";
import type { ListenBrainzApi } from "../api.js";
import type { ListenBrainzDb } from "../db.js";
import type { ListenBrainzUserConfig } from "../user-config.js";

export interface ListenBrainzContext {
	api: ListenBrainzApi;
	db: ListenBrainzDb;
	userConfig: ListenBrainzUserConfig;
	dataClient: DataClient;
	historyClient: PlaybackHistoryClient;
	playlistClient: WritablePlaylistClient;
	getSearchClient: () => Promise<SearchClient | null>;
}

export interface MbIndexTrack {
	uuid: string;
	attributes: SavedAttribute[];
}

export type ListensSubTask = "all" | "new";
export type PlaylistsSubTask = "loved-tracks" | "recommendations";
