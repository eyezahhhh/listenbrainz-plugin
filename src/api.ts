import { Agent } from "undici";

const BASE_URL = "https://api.listenbrainz.org";
const ipv4Agent = new Agent({ connect: { family: 4 } });

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

async function checkResponse(response: Response): Promise<void> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`ListenBrainz API error ${response.status}: ${body}`);
	}
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

		const response = await fetch(`${BASE_URL}/1/submit-listens`, {
			method: "POST",
			headers: {
				Authorization: `Token ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				listen_type: listenType,
				payload,
			}),
			// @ts-ignore
			dispatcher: ipv4Agent,
		});

		await checkResponse(response);
	}

	async getLovedTracks(
		username: string,
		count: number = 100,
		offset: number = 0,
	): Promise<{ mbid: string; listenedAt: number }[]> {
		const url = new URL(`${BASE_URL}/1/feedback/user/${username}/get-feedback`);
		url.searchParams.set("score", "1");
		url.searchParams.set("count", String(count));
		url.searchParams.set("offset", String(offset));

		const response = await fetch(url.toString(), {
			// @ts-ignore
			dispatcher: ipv4Agent,
		});
		await checkResponse(response);

		const data = (await response.json()) as {
			feedback: Array<{ recording_mbid: string | null; created: number }>;
		};

		const results: { mbid: string; listenedAt: number }[] = [];

		for (const entry of data.feedback) {
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
		const url = new URL(
			`${BASE_URL}/1/cf/recommendation/user/${username}/recording`,
		);
		url.searchParams.set("count", String(count));
		url.searchParams.set("offset", String(offset));

		const response = await fetch(url.toString(), {
			// @ts-ignore
			dispatcher: ipv4Agent,
		});
		await checkResponse(response);

		const data = (await response.json()) as {
			payload: { mbids: Array<{ recording_mbid: string | null }> };
		};

		const results: { mbid: string }[] = [];

		for (const entry of data.payload.mbids) {
			if (entry.recording_mbid === null || entry.recording_mbid === undefined) {
				continue;
			}

			results.push({ mbid: entry.recording_mbid });
		}

		return results;
	}

	async validateToken(token: string): Promise<boolean> {
		const response = await fetch(`${BASE_URL}/1/validate-token`, {
			headers: {
				Authorization: `Token ${token}`,
			},
			// @ts-ignore
			dispatcher: ipv4Agent,
		});

		await checkResponse(response);

		const data = (await response.json()) as { valid: boolean };
		return data.valid;
	}
}
