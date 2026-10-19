import Axios from "axios";

export function rethrowAxiosError(error: unknown): never {
	if (Axios.isAxiosError(error) && error.response) {
		throw new Error(
			`ListenBrainz API error ${error.response.status}: ${String(error.response.data)}`,
		);
	}
	throw error;
}
