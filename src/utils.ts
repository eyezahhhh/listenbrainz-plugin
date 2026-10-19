import { BufferAttributeValue } from "@pipe-bomb/plugin-sdk";
import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

const COVER_SIZE = 1_400;

export async function createPlaylistCover(image: string): Promise<Buffer> {
	const backgroundRawBuffer = await fetch(image).then((r) => r.arrayBuffer());

	const logoRawBuffer = await readFile(
		path.join(__dirname, "../assets/logo-plain.svg"),
	);
	const logoSharp = await sharp(logoRawBuffer)
		.resize(COVER_SIZE * 0.6, COVER_SIZE * 0.6, {
			fit: "cover",
		})
		.toBuffer();

	return await sharp(backgroundRawBuffer)
		.resize(COVER_SIZE, COVER_SIZE, {
			fit: "cover",
		})
		.blur(10)
		.modulate({ brightness: 0.55 })
		.composite([
			{
				input: logoSharp,
				gravity: "center",
			},
		])
		.jpeg({ quality: 85 })
		.toBuffer();
}
