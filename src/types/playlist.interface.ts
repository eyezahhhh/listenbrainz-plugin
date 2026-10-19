export type ListenBrainzPlaylistType = "loved" | "recommendations";

export interface DiscoveredPlaylist {
	uuid: string;
	userUuid: string | null;
	type: ListenBrainzPlaylistType | null;
}

export interface DiscoveredMappings {
	mappings: Map<string, Partial<Record<ListenBrainzPlaylistType, string>>>;
	playlists: DiscoveredPlaylist[];
}
