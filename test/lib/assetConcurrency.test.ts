import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createApplicationAndAssetBundle,
	unpackApplicationAndAssetBundle,
	validateAssetLimits
} from '../../src/lib/moduleEncoding';

const counters = vi.hoisted(() => ({
	reads: { inFlight: 0, peak: 0 },
	deflates: { inFlight: 0, peak: 0 }
}));

vi.mock('zlib', async (importOriginal) => {
	const zlib = await importOriginal<typeof import('zlib')>();
	return {
		...zlib,
		deflateRaw: (data: Buffer, options: object, callback: (error: Error | null, result: Buffer) => void) => {
			counters.deflates.inFlight++;
			counters.deflates.peak = Math.max(counters.deflates.peak, counters.deflates.inFlight);
			zlib.deflateRaw(data, options, (error, result) => {
				counters.deflates.inFlight--;
				callback(error, result);
			});
		}
	};
});

const APPLICATION = path.resolve(__dirname, '../binaries/p2-tinker@5.3.1.bin');
const ASSET_COUNT = 20;

describe('asset processing concurrency', () => {
	let dir: string;
	let assetPaths: string[];

	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bvr-assets-'));
		assetPaths = Array.from({ length: ASSET_COUNT }, (_, i) => {
			const file = path.join(dir, `asset${String(i).padStart(2, '0')}.txt`);
			fs.writeFileSync(file, `asset ${i}\n`.repeat(50));
			return file;
		});
	});

	afterAll(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	beforeEach(() => {
		const readFile = fs.promises.readFile;
		vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args: Parameters<typeof readFile>) => {
			counters.reads.inFlight++;
			counters.reads.peak = Math.max(counters.reads.peak, counters.reads.inFlight);
			try {
				return await readFile(...args);
			} finally {
				counters.reads.inFlight--;
			}
		});
		counters.reads.peak = 0;
		counters.deflates.peak = 0;
		return () => vi.restoreAllMocks();
	});

	it('validateAssetLimits reads and compresses asset paths one at a time, in order', async () => {
		const details = await validateAssetLimits(APPLICATION, assetPaths);
		expect(counters.reads.peak).toBe(1);
		expect(counters.deflates.peak).toBe(1);
		expect(details.assets.map((asset) => asset.name)).toEqual(assetPaths.map((file) => path.basename(file)));
	});

	it('createApplicationAndAssetBundle reads and compresses asset paths one at a time, in order', async () => {
		const bundle = await createApplicationAndAssetBundle(APPLICATION, assetPaths);
		expect(counters.reads.peak).toBe(1);
		expect(counters.deflates.peak).toBe(1);
		const unpacked = await unpackApplicationAndAssetBundle(bundle);
		expect(unpacked.assets.map((asset) => asset.name)).toEqual(assetPaths.map((file) => path.basename(file)));
	});
});
