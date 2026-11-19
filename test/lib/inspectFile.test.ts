import * as path from 'path';

import { describe, it, expect } from 'vitest';

import { inspectFile } from '../../src/lib/inspectFile';

const BINARIES = path.resolve(__dirname, '../binaries');

describe('inspectFile', () => {
	it('outputs valid JSON for a valid binary', async () => {
		const parsed = JSON.parse(await inspectFile(path.join(BINARIES, 'p2-tinker@5.3.1.bin')));
		expect(parsed).toHaveProperty('prefixInfo');
		expect(parsed).toHaveProperty('suffixInfo');
		expect(parsed).toHaveProperty('crc');
		expect(parsed).not.toHaveProperty('fileBuffer');
	});

	it('hex-encodes buffers', async () => {
		const parsed = JSON.parse(await inspectFile(path.join(BINARIES, 'p2-tinker@5.3.1.bin')));
		expect(parsed.suffixInfo.extensions[0].data).toMatch(/^[0-9a-f]+$/);
	});

	it('rejects when the file does not exist', async () => {
		await expect(inspectFile('nonexistent.bin')).rejects.toThrow(/doesn't exist/);
	});
});
