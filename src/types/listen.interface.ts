export interface ListenPayload {
	listenedAt: number;
	trackName: string;
	artistName: string;
	releaseName?: string;
	recordingMbid?: string;
}

export interface LbTrackMetadata {
	artist_name: string;
	track_name: string;
	release_name?: string;
	additional_info: {
		listening_from: string;
		recording_mbid?: string;
	};
}

export interface LbListen {
	listened_at: number;
	track_metadata: LbTrackMetadata;
}

export interface FingerprintEntry {
	fingerprint: string;
	userUuid: string;
	datePlayed: number;
	dateRecorded: number;
}

export interface PendingListen {
	payload: ListenPayload;
	entry: FingerprintEntry;
}

export interface RecordingMetadata {
	title: string;
	artistNames: string[];
	releaseName: string | null;
	isrcs: string[];
	durationSeconds: number | null;
}

export interface LbMetadataArtist {
	name: string;
}

export interface LbMetadataRecording {
	name: string;
	length: number | null;
	isrcs: string[] | null;
}

export interface LbMetadataRelease {
	name: string | null;
}

export interface LbMetadataEntry {
	artist: {
		name: string | null;
		artists: LbMetadataArtist[] | null;
	} | null;
	recording: LbMetadataRecording | null;
	release: LbMetadataRelease | null;
}

export type LbMetadataResponse = Record<string, LbMetadataEntry>;

