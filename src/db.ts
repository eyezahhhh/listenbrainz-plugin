import Database from "better-sqlite3";

export class ListenBrainzDb {
	private db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS lb_users (
				user_uuid      TEXT PRIMARY KEY,
				lb_username    TEXT NOT NULL,
				loved_playlist TEXT,
				recs_playlist  TEXT
			);

			CREATE TABLE IF NOT EXISTS submitted_listens (
				fingerprint   TEXT PRIMARY KEY,
				user_uuid     TEXT NOT NULL,
				date_played   INTEGER NOT NULL,
				date_recorded INTEGER NOT NULL,
				submitted_at  INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_submitted_user
				ON submitted_listens(user_uuid);

			CREATE INDEX IF NOT EXISTS idx_submitted_recorded
				ON submitted_listens(user_uuid, date_recorded);
		`);
	}

	upsertUser(userUuid: string, lbUsername: string): void {
		this.db
			.prepare(
				`INSERT INTO lb_users (user_uuid, lb_username)
			VALUES (@userUuid, @lbUsername)
			ON CONFLICT(user_uuid) DO UPDATE SET lb_username = excluded.lb_username`,
			)
			.run({ userUuid, lbUsername });
	}

	getUser(userUuid: string): {
		userUuid: string;
		lbUsername: string;
		lovedPlaylist: string | null;
		recsPlaylist: string | null;
	} | null {
		const row = this.db
			.prepare(
				`SELECT user_uuid, lb_username, loved_playlist, recs_playlist
			FROM lb_users WHERE user_uuid = ?`,
			)
			.get(userUuid) as
			| {
					user_uuid: string;
					lb_username: string;
					loved_playlist: string | null;
					recs_playlist: string | null;
			  }
			| undefined;

		if (!row) {
			return null;
		}

		return {
			userUuid: row.user_uuid,
			lbUsername: row.lb_username,
			lovedPlaylist: row.loved_playlist,
			recsPlaylist: row.recs_playlist,
		};
	}

	getAllUsers(): Array<{
		userUuid: string;
		lbUsername: string;
		lovedPlaylist: string | null;
		recsPlaylist: string | null;
	}> {
		const rows = this.db
			.prepare(
				`SELECT user_uuid, lb_username, loved_playlist, recs_playlist FROM lb_users`,
			)
			.all() as Array<{
			user_uuid: string;
			lb_username: string;
			loved_playlist: string | null;
			recs_playlist: string | null;
		}>;

		return rows.map((row) => ({
			userUuid: row.user_uuid,
			lbUsername: row.lb_username,
			lovedPlaylist: row.loved_playlist,
			recsPlaylist: row.recs_playlist,
		}));
	}

	setLovedPlaylist(userUuid: string, playlistUuid: string): void {
		this.db
			.prepare(`UPDATE lb_users SET loved_playlist = ? WHERE user_uuid = ?`)
			.run(playlistUuid, userUuid);
	}

	setRecsPlaylist(userUuid: string, playlistUuid: string): void {
		this.db
			.prepare(`UPDATE lb_users SET recs_playlist = ? WHERE user_uuid = ?`)
			.run(playlistUuid, userUuid);
	}

	removeUser(userUuid: string): void {
		this.db.prepare(`DELETE FROM lb_users WHERE user_uuid = ?`).run(userUuid);
	}

	hasFingerprint(fingerprint: string): boolean {
		const row = this.db
			.prepare(`SELECT 1 FROM submitted_listens WHERE fingerprint = ? LIMIT 1`)
			.get(fingerprint);

		if (row) {
			return true;
		}

		return false;
	}

	insertFingerprints(
		entries: Array<{
			fingerprint: string;
			userUuid: string;
			datePlayed: number;
			dateRecorded: number;
		}>,
	): void {
		const stmt = this.db.prepare(
			`INSERT OR IGNORE INTO submitted_listens
			(fingerprint, user_uuid, date_played, date_recorded, submitted_at)
			VALUES (?, ?, ?, ?, ?)`,
		);

		const now = Date.now();

		const insertMany = this.db.transaction((items: typeof entries) => {
			for (const entry of items) {
				stmt.run(
					entry.fingerprint,
					entry.userUuid,
					entry.datePlayed,
					entry.dateRecorded,
					now,
				);
			}
		});

		insertMany(entries);
	}

	clearFingerprints(userUuid: string): void {
		this.db
			.prepare(`DELETE FROM submitted_listens WHERE user_uuid = ?`)
			.run(userUuid);
	}

	close(): void {
		this.db.close();
	}
}
