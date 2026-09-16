import {
	AlbumInformationHelper,
	AlbumMetadata,
	ArtistInformationHelper,
	ArtistMetadata,
	AttributeSource,
	AttributeSourceApiContext,
	TrackAttributionHelper,
	TrackMetadata,
} from "@pipe-bomb/plugin-sdk";

export class ListenBrainzAttributeSource implements AttributeSource {
	id = "listenbrainz";

	enable(api: AttributeSourceApiContext): void {
		api.registerPlaylistAttributes([
			{
				type: "string",
				key: "title",
				supportsMultiple: false,
			},
		]);
	}

	getName(): string {
		return "ListenBrainz";
	}

	async getTrackAttributeValues(
		_helper: TrackAttributionHelper,
	): Promise<TrackMetadata> {
		return {
			artists: null,
			attributes: null,
		};
	}

	async getArtistAttributeValues(
		_helper: ArtistInformationHelper,
	): Promise<ArtistMetadata> {
		return {
			attributes: null,
		};
	}

	async getAlbumAttributeValues(
		_helper: AlbumInformationHelper,
	): Promise<AlbumMetadata> {
		return {
			artists: null,
			attributes: null,
		};
	}
}
