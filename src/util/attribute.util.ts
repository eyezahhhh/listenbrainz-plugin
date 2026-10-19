import type { SavedAttribute } from "@pipe-bomb/plugin-sdk";

export function getStringAttr(
	attrs: SavedAttribute[] | null | undefined,
	key: string,
): string | undefined {
	const attr = attrs?.find((a) => a.key === key && a.type === "string");
	if (!attr) {
		return undefined;
	}
	return (attr.values as string[])[0];
}
