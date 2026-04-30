function readBalancedBraceContent(
	value: string,
	braceStartIndex: number
): { content: string; nextIndex: number } | null {
	if (value[braceStartIndex] !== "{") return null;

	let depth = 0;
	for (let index = braceStartIndex; index < value.length; index += 1) {
		const char = value[index];
		if (char === "{") {
			depth += 1;
			continue;
		}
		if (char !== "}") continue;
		depth -= 1;
		if (depth === 0) {
			return {
				content: value.slice(braceStartIndex + 1, index),
				nextIndex: index + 1,
			};
		}
	}

	return null;
}

function replaceBmMacros(value: string): string {
	let cursor = 0;
	let result = "";

	while (cursor < value.length) {
		const macroIndex = value.indexOf("\\bm", cursor);
		if (macroIndex < 0) {
			result += value.slice(cursor);
			break;
		}

		result += value.slice(cursor, macroIndex);
		let argumentStart = macroIndex + 3;
		while (/\s/.test(value[argumentStart] ?? "")) {
			argumentStart += 1;
		}

		if (value[argumentStart] === "{") {
			const balanced = readBalancedBraceContent(value, argumentStart);
			if (balanced) {
				result += `\\boldsymbol{${balanced.content}}`;
				cursor = balanced.nextIndex;
				continue;
			}
		}

		const commandMatch = /^\\[A-Za-z]+/.exec(value.slice(argumentStart));
		if (commandMatch?.[0]) {
			result += `\\boldsymbol{${commandMatch[0]}}`;
			cursor = argumentStart + commandMatch[0].length;
			continue;
		}

		const symbol = value[argumentStart];
		if (symbol) {
			result += `\\boldsymbol{${symbol}}`;
			cursor = argumentStart + 1;
			continue;
		}

		result += "\\bm";
		cursor = macroIndex + 3;
	}

	return result;
}

export function sanitizeMathForObsidian(value: string): string {
	return replaceBmMacros(value);
}

export function sanitizeMarkdownForObsidian(value: string): string {
	return sanitizeMathForObsidian(value.replace(/\r\n?/g, "\n"));
}