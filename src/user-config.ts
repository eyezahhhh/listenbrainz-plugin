import type {
	UserConfigManager,
	UserConfigManagerApiContext,
	ConfigNode,
} from "@pipe-bomb/plugin-sdk";
import { ListenBrainzDb } from "./db.js";

export class ListenBrainzUserConfig implements UserConfigManager {
	private ctx!: UserConfigManagerApiContext;

	constructor(private readonly db: ListenBrainzDb) {}

	enable(ctx: UserConfigManagerApiContext): void {
		this.ctx = ctx;
	}

	canUserAccess(_userUuid: string): boolean {
		return true;
	}

	async getConfigOptions(userUuid: string): Promise<ConfigNode | null> {
		const token = await this.getToken(userUuid);
		const username = await this.getUsername(userUuid);
		const scrobble = await this.ctx.getValue(
			userUuid,
			"scrobble_enabled",
			"string",
		);
		const loved = await this.ctx.getValue(userUuid, "loved_enabled", "string");
		const recs = await this.ctx.getValue(userUuid, "recs_enabled", "string");

		return {
			type: "section",
			children: [
				{
					type: "text",
					id: "token",
					name: "ListenBrainz User Token",
					value: token ?? "",
					placeholder: "your-token-here",
				},
				{
					type: "text",
					id: "username",
					name: "ListenBrainz Username",
					value: username ?? "",
					placeholder: "your-username",
				},
				{
					type: "heading",
					size: "sm",
					content: "Sync options",
				},
				{
					type: "text",
					id: "scrobble_enabled",
					name: "Enable scrobbling (true/false)",
					value: scrobble ?? "true",
					placeholder: "true",
				},
				{
					type: "text",
					id: "loved_enabled",
					name: "Enable loved tracks sync (true/false)",
					value: loved ?? "true",
					placeholder: "true",
				},
				{
					type: "text",
					id: "recs_enabled",
					name: "Enable recommendations sync (true/false)",
					value: recs ?? "true",
					placeholder: "true",
				},
			],
		};
	}

	async update(
		userUuid: string,
		values: Record<string, any>,
	): Promise<ConfigNode | null> {
		const fields = [
			"token",
			"username",
			"scrobble_enabled",
			"loved_enabled",
			"recs_enabled",
		] as const;

		for (const key of fields) {
			const value = values[key];

			if (typeof value === "string" && value.trim()) {
				await this.ctx.setValue(userUuid, key, "string", value.trim());
			} else {
				await this.ctx.delete(userUuid, key);
			}
		}

		const token = await this.getToken(userUuid);
		const username = await this.getUsername(userUuid);

		if (token && username) {
			this.db.upsertUser(userUuid, username);
		} else {
			this.db.removeUser(userUuid);
		}

		return this.getConfigOptions(userUuid);
	}

	async getToken(userUuid: string): Promise<string | null> {
		return this.ctx.getValue(userUuid, "token", "string");
	}

	async getUsername(userUuid: string): Promise<string | null> {
		return this.ctx.getValue(userUuid, "username", "string");
	}

	async isScrobbleEnabled(userUuid: string): Promise<boolean> {
		const value = await this.ctx.getValue(
			userUuid,
			"scrobble_enabled",
			"string",
		);

		if (value === null) {
			return true;
		}

		return value === "true";
	}

	async isLovedEnabled(userUuid: string): Promise<boolean> {
		const value = await this.ctx.getValue(userUuid, "loved_enabled", "string");

		if (value === null) {
			return true;
		}

		return value === "true";
	}

	async isRecsEnabled(userUuid: string): Promise<boolean> {
		const value = await this.ctx.getValue(userUuid, "recs_enabled", "string");

		if (value === null) {
			return true;
		}

		return value === "true";
	}
}
