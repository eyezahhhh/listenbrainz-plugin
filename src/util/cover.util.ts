import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const COVER_SIZE = 1_400;
const COVER_GRID_SIZE = 2;

export const COVER_COLLAGE_SIZE = COVER_GRID_SIZE * COVER_GRID_SIZE;

async function loadLogo(): Promise<Buffer> {
	const logoRawBuffer = await readFile(
		path.join(__dirname, "../../assets/logo_plain.svg"),
	);
	return sharp(logoRawBuffer)
		.resize(COVER_SIZE * 0.6, COVER_SIZE * 0.6, {
			fit: "cover",
		})
		.toBuffer();
}

export async function createPlaylistCover(covers: Buffer[]): Promise<Buffer> {
	const logo = await loadLogo();

	if (covers.length >= COVER_COLLAGE_SIZE) {
		return createCollage(covers.slice(0, COVER_COLLAGE_SIZE), logo);
	}

	return sharp(covers[0]!)
		.resize(COVER_SIZE, COVER_SIZE, {
			fit: "cover",
		})
		.blur(10)
		.modulate({ brightness: 0.55 })
		.composite([
			{
				input: logo,
				gravity: "center",
			},
		])
		.jpeg({ quality: 85 })
		.toBuffer();
}

async function createCollage(covers: Buffer[], logo: Buffer): Promise<Buffer> {
	const tile = Math.floor(COVER_SIZE / COVER_GRID_SIZE);

	const tiles = await Promise.all(
		covers.map(async (cover, index) => ({
			input: await sharp(cover)
				.resize(tile, tile, { fit: "cover" })
				.modulate({ brightness: 0.7 })
				.toBuffer(),
			left: (index % COVER_GRID_SIZE) * tile,
			top: Math.floor(index / COVER_GRID_SIZE) * tile,
		})),
	);

	const grid = await sharp({
		create: {
			width: tile * COVER_GRID_SIZE,
			height: tile * COVER_GRID_SIZE,
			channels: 3,
			background: { r: 0, g: 0, b: 0 },
		},
	})
		.composite(tiles)
		.png()
		.toBuffer();

	return sharp(grid)
		.composite([
			{
				input: logo,
				gravity: "center",
			},
		])
		.jpeg({ quality: 85 })
		.toBuffer();
}
