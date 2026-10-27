/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Subset of VS Code 1.106.0 src/vs/editor/common/core/text/abstractText.ts used by
// the diff algorithm. Only line lengths and the line count are needed.

export abstract class AbstractText {
	abstract readonly length: { readonly lineCount: number };
	abstract getLineLength(lineNumber: number): number;
}

export class ArrayText extends AbstractText {
	constructor(private readonly lines: string[]) {
		super();
	}

	get length(): { readonly lineCount: number } {
		// Matches TextLength.lineCount: the number of line breaks.
		return { lineCount: this.lines.length - 1 };
	}

	override getLineLength(lineNumber: number): number {
		return this.lines[lineNumber - 1].length;
	}
}
