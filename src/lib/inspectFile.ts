import { HalModuleParser } from './HalModuleParser';

/**
 * Parses a module binary and formats the result as the CLI prints it.
 *
 * @returns Indented JSON without the file contents, with buffers as hex strings
 */
export async function inspectFile(filename: string): Promise<string> {
	const { fileBuffer: _fileBuffer, ...output } = await new HalModuleParser().parseFile(filename);
	return JSON.stringify(output, hexEncodeBuffers, 2);
}

function hexEncodeBuffers(_key: string, value: unknown): unknown {
	return isSerializedBuffer(value) ? Buffer.from(value.data).toString('hex') : value;
}

function isSerializedBuffer(value: unknown): value is { type: 'Buffer'; data: number[] } {
	return (
		!!value && (value as { type?: unknown }).type === 'Buffer' && Array.isArray((value as { data?: unknown }).data)
	);
}
