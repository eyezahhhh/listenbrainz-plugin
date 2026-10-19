import Axios, { type AxiosInstance } from "axios";
import type {
	LbListen,
	LbMetadataResponse,
	LbTrackMetadata,
	ListenPayload,
	RecordingMetadata,
} from "./types/listen.interface.js";
import { rethrowAxiosError } from "./util/error.util.js";

const METADATA_BATCH_SIZE = 100;

export class ListenBrainzApi {
	private readonly http: AxiosInstance = Axios.create({
		baseURL: "https://api.listenbrainz.org",
		family: 4,
	});

	async submitListens(
		token: string,
		listens: ListenPayload[],
		listenType: "import" | "single" = "import",
	): Promise<void> {
		const payload: LbListen[] = listens.map((listen) => {
			const additionalInfo: LbTrackMetadata["additional_info"] = {
				listening_from: "Pipe Bomb",
			};

			if (listen.recordingMbid !== undefined) {
				additionalInfo.recording_mbid = listen.recordingMbid;
			}

			const trackMetadata: LbTrackMetadata = {
				artist_name: listen.artistName,
				track_name: listen.trackName,
				additional_info: additionalInfo,
			};

			if (listen.releaseName !== undefined) {
				trackMetadata.release_name = listen.releaseName;
			}

			return {
				listened_at: listen.listenedAt,
				track_metadata: trackMetadata,
			};
		});

		try {
			await this.http.post(
				"/1/submit-listens",
				{
					listen_type: listenType,
					payload,
				},
				{
					headers: {
						Authorization: `Token ${token}`,
					},
				},
			);
		} catch (error) {
			rethrowAxiosError(error);
		}
	}

	async getLovedTracks(
		username: string,
		count: number = 100,
		offset: number = 0,
	): Promise<{ mbid: string; listenedAt: number }[]> {
		let response;
		try {
			response = await this.http.get<{
				feedback: Array<{ recording_mbid: string | null; created: number }>;
			}>(`/1/feedback/user/${username}/get-feedback`, {
				params: { score: 1, count, offset },
			});
		} catch (error) {
			rethrowAxiosError(error);
		}

		const results: { mbid: string; listenedAt: number }[] = [];

		for (const entry of response.data.feedback) {
			if (entry.recording_mbid === null || entry.recording_mbid === undefined) {
				continue;
			}

			results.push({
				mbid: entry.recording_mbid,
				listenedAt: entry.created,
			});
		}

		return results;
	}

	async getRecommendations(
		username: string,
		count: number = 100,
		offset: number = 0,
	): Promise<{ mbid: string }[]> {
		let response;
		try {
			response = await this.http.get<{
				payload: { mbids: Array<{ recording_mbid: string | null }> };
			}>(`/1/cf/recommendation/user/${username}/recording`, {
				params: { count, offset },
			});
		} catch (error) {
			rethrowAxiosError(error);
		}

		const results: { mbid: string }[] = [];

		for (const entry of response.data.payload.mbids) {
			if (entry.recording_mbid === null || entry.recording_mbid === undefined) {
				continue;
			}

			results.push({ mbid: entry.recording_mbid });
		}

		return results;
	}

	async validateToken(token: string): Promise<boolean> {
		let response;
		try {
			response = await this.http.get<{ valid: boolean }>("/1/validate-token", {
				headers: {
					Authorization: `Token ${token}`,
				},
			});
		} catch (error) {
			rethrowAxiosError(error);
		}

		return response.data.valid;
	}

	async getRecordingMetadata(
		mbids: string[],
	): Promise<Map<string, RecordingMetadata>> {
		const metadata = new Map<string, RecordingMetadata>();
		const unique = [...new Set(mbids)];

		for (let index = 0; index < unique.length; index += METADATA_BATCH_SIZE) {
			const batch = unique.slice(index, index + METADATA_BATCH_SIZE);

			let response;
			try {
				response = await this.http.get<LbMetadataResponse>(
					"/1/metadata/recording/",
					{
						params: {
							recording_mbids: batch.join(","),
							inc: "artist release",
						},
					},
				);
			} catch (error) {
				rethrowAxiosError(error);
			}

			for (const [mbid, entry] of Object.entries(response.data)) {
				const recording = entry.recording;
				if (!recording?.name) {
					continue;
				}

				const artistNames = (entry.artist?.artists ?? [])
					.map((artist) => artist.name)
					.filter((name): name is string => Boolean(name));

				metadata.set(mbid, {
					title: recording.name,
					artistNames:
						artistNames.length > 0
							? artistNames
							: entry.artist?.name
								? [entry.artist.name]
								: [],
					releaseName: entry.release?.name ?? null,
					isrcs: recording.isrcs ?? [],
					durationSeconds:
						typeof recording.length === "number"
							? recording.length / 1000
							: null,
				});
			}
		}

		return metadata;
	}
}
