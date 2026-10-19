import { setDefaultResultOrder } from "node:dns";
import type PipeBomb from "@pipe-bomb/plugin-sdk";
import { ListenBrainzApi } from "./api.js";

setDefaultResultOrder("ipv4first");
import { ListenBrainzDb } from "./db.js";
import { ListenBrainzUserConfig } from "./user-config.js";
import { ListensTask, PlaylistsTask } from "./sync-task.js";
import path from "node:path";
import { ListenBrainzAttributeSource } from "./listenbrainz.attribute-source.js";
import { ListenbrainzExternalUrlSource } from "./listenbrainz.external-url-source.js";
import { PLAYLIST_BOT_ID } from "./const/playlist-bot-id.const.js";
import type { ListenBrainzTask } from "./task-base.js";
import type { ListenBrainzContext } from "./types/task.interface.js";
import { SublimatePlugin } from "sublimate";

export default class Plugin implements PipeBomb.Plugin {
	private ctx: PipeBomb.PluginApiContext | null = null;
	private db: ListenBrainzDb | null = null;
	private api: ListenBrainzApi | null = null;
	private userConfig: ListenBrainzUserConfig | null = null;
	private tasks: ListenBrainzTask[] = [];

	async enable(ctx: PipeBomb.PluginApiContext): Promise<void> {
		this.ctx = ctx;

		ctx.registerLanguageDirectory("lang");
		ctx.registerIconDirectory("icons");

		const cacheDir = await ctx.requestCacheDirectory();
		const dbPath = path.join(cacheDir, "listenbrainz.db");

		const db = new ListenBrainzDb(dbPath);
		this.db = db;

		const api = new ListenBrainzApi();
		this.api = api;

		const userConfig = new ListenBrainzUserConfig(db);
		this.userConfig = userConfig;

		ctx.registerUserConfigManager("listenbrainz", userConfig);

		const context: ListenBrainzContext = {
			api,
			db,
			userConfig,
			dataClient: ctx.getDataClient(),
			historyClient: ctx.getPlaybackHistoryClient(),
			playlistClient: ctx.getPlaylistClient({
				id: PLAYLIST_BOT_ID,
				name: "ListenBrainz",
			}),
			getSearchClient: () => this.getSearchClient(),
		};

		ctx.registerAttributeSource(new ListenBrainzAttributeSource());

		const listensTask = new ListensTask(context);
		const playlistsTask = new PlaylistsTask(context);

		this.tasks = [listensTask, playlistsTask];

		ctx.registerTask(listensTask);
		ctx.registerTask(playlistsTask);

		ctx.registerExternalUrlSource(new ListenbrainzExternalUrlSource());
	}

	disable(): void {
		for (const task of this.tasks) {
			task.dispose();
		}
		this.tasks = [];

		this.userConfig?.dispose();
		this.userConfig = null;
		this.api = null;

		this.db?.close();
		this.db = null;
		this.ctx = null;
	}

	private async getSearchClient() {
		if (!this.ctx) {
			return null;
		}

		const plugin =
			await this.ctx.getPlugin<SublimatePlugin>("ephemeral-import");
		return plugin?.getSearchClient() ?? null;
	}
}
