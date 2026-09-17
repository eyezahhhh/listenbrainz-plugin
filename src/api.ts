import Axios from "axios";

const axios = Axios.create({
	baseURL: "https://api.listenbrainz.org",
	family: 4,
});

export interface ListenPayload {
	listenedAt: number;
	trackName: string;
	artistName: string;
	releaseName?: string;
	recordingMbid?: string;
}

interface LbTrackMetadata {
	artist_name: string;
	track_name: string;
	release_name?: string;
	additional_info: {
		listening_from: string;
		recording_mbid?: string;
	};
}

interface LbListen {
	listened_at: number;
	track_metadata: LbTrackMetadata;
}

function rethrowAxiosError(error: unknown): never {
	if (Axios.isAxiosError(error) && error.response) {
		throw new Error(
			`ListenBrainz API error ${error.response.status}: ${String(error.response.data)}`,
		);
	}
	throw error;
}

export class ListenBrainzApi {
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
			await axios.post(
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
			response = await axios.get<{
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
			response = await axios.get<{
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
			response = await axios.get<{ valid: boolean }>("/1/validate-token", {
				headers: {
					Authorization: `Token ${token}`,
				},
			});
		} catch (error) {
			rethrowAxiosError(error);
		}

		return response.data.valid;
	}
}
