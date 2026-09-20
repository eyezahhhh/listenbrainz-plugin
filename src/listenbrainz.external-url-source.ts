import {
	AlbumExternalUrlHelper,
	ArtistExternalUrlHelper,
	ExternalUrl,
	ExternalUrlSource,
	TrackExternalUrlHelper,
} from "@pipe-bomb/plugin-sdk";

export class ListenbrainzExternalUrlSource implements ExternalUrlSource {
	getArtistUrls(helper: ArtistExternalUrlHelper): ExternalUrl[] | null {
		const identity = helper.getIdentity("musicbrainz_artist_id");
		if (identity) {
			return [
				{
					iconId: "logo",
					name: "ListenBrainz",
					url: `https://listenbrainz.org/artist/${identity.identity}`,
				},
			];
		}
		return null;
	}

	getTrackUrls(helper: TrackExternalUrlHelper): ExternalUrl[] | null {
		const identity = helper.getIdentity("musicbrainz_recording_id");
		if (identity) {
			return [
				{
					iconId: "logo",
					name: "ListenBrainz",
					url: `https://listenbrainz.org/track/${identity.identity}`,
				},
			];
		}
		return null;
	}

	getAlbumUrls(helper: AlbumExternalUrlHelper): ExternalUrl[] | null {
		const identity = helper.getIdentity("musicbrainz_release_group_id");
		if (identity) {
			return [
				{
					iconId: "logo",
					name: "ListenBrainz",
					url: `https://listenbrainz.org/album/${identity.identity}`,
				},
			];
		}
		return null;
	}
}
