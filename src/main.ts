import { setDefaultResultOrder } from "node:dns";
import type PipeBomb from "@pipe-bomb/plugin-sdk";
import { ListenBrainzApi } from "./api.js";

setDefaultResultOrder("ipv4first");
import { ListenBrainzDb } from "./db.js";
import { ListenBrainzUserConfig } from "./user-config.js";
import { ListensTask, PlaylistsTask } from "./sync-task.js";
import path from "node:path";
import { ListenBrainzAttributeSource } from "./listenbrainz.attribute-source.js";

export default class Plugin implements PipeBomb.Plugin {
	private db: ListenBrainzDb | null = null;

	async enable(ctx: PipeBomb.PluginApiContext): Promise<void> {
		ctx.registerLanguageDirectory("lang");

		const cacheDir = await ctx.requestCacheDirectory();
		const dbPath = path.join(cacheDir, "listenbrainz.db");

		const db = new ListenBrainzDb(dbPath);
		this.db = db;

		const api = new ListenBrainzApi();
		const userConfig = new ListenBrainzUserConfig(db);

		ctx.registerUserConfigManager("listenbrainz", userConfig);

		const historyClient = ctx.getPlaybackHistoryClient();
		const dataClient = ctx.getDataClient();
		const playlistClient = ctx.getPlaylistClient();

		ctx.registerAttributeSource(new ListenBrainzAttributeSource());

		const listensTask = new ListensTask(
			api,
			db,
			userConfig,
			historyClient,
			dataClient,
		);
		const playlistsTask = new PlaylistsTask(
			api,
			db,
			userConfig,
			dataClient,
			playlistClient,
		);

		ctx.registerTask(listensTask);
		ctx.registerTask(playlistsTask);
	}

	disable(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}
