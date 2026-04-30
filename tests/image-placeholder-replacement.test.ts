import { describe, expect, it } from "vitest";
import { replaceImagePlaceholders } from "../src/services/high-effort-summary-orchestrator";
import type { MarkdownContentPointer } from "../src/types";

function imagePointer(id: string, content: string): MarkdownContentPointer {
	return {
		id,
		kind: "image",
		ordinal: 1,
		sectionPath: ["Title"],
		excerpt: "Caption",
		lineStart: 1,
		lineEnd: 1,
		charStart: 0,
		charEnd: content.length,
		contentHash: "h",
		content,
	};
}

describe("replaceImagePlaceholders", () => {
	it("replaces a known placeholder with the full markdown image syntax", () => {
		const map = new Map<string, MarkdownContentPointer>();
		map.set("image:1:abc", imagePointer("image:1:abc", "![arch](https://example.com/x.png)"));

		const result = replaceImagePlaceholders(
			"See diagram below.\n\n[[IMAGE:image:1:abc]]\n\nIt shows the pipeline.",
			map
		);

		expect(result).toContain("![arch](https://example.com/x.png)");
		expect(result).not.toContain("[[IMAGE:");
	});

	it("removes placeholders for unknown ids", () => {
		const map = new Map<string, MarkdownContentPointer>();

		const result = replaceImagePlaceholders(
			"Before\n\n[[IMAGE:nope]]\n\nAfter",
			map
		);

		expect(result).not.toContain("[[IMAGE:");
		expect(result).toContain("Before");
		expect(result).toContain("After");
	});

	it("falls back to suffix-based id matching when the model emits a partial id", () => {
		const map = new Map<string, MarkdownContentPointer>();
		map.set(
			"image:3:figure-overview",
			imagePointer("image:3:figure-overview", "![overview](https://example.com/o.png)")
		);

		const result = replaceImagePlaceholders("[[IMAGE:figure-overview]]", map);

		expect(result).toContain("![overview](https://example.com/o.png)");
	});
});
