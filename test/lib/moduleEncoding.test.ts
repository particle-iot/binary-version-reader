/* oxlint-disable no-await-in-loop */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { buffer } from 'stream/consumers';

import { schema as protobufSchema } from '@particle/device-os-protobuf';
import { ZipArchive } from 'archiver';
import crc32 from 'buffer-crc32';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

import { config, type Config } from '../../src/lib/config';
import { createFirmwareBinary } from '../../src/lib/firmwareTestHelper';
import { HalModuleParser, type FileInfo, type ModuleExtension } from '../../src/lib/HalModuleParser';
import {
	updateModuleSha256,
	updateModuleCrc32,
	updateModulePrefix,
	updateModuleSuffix,
	compressModule,
	decompressModule,
	combineModules,
	splitCombinedModules,
	createAssetModule,
	unwrapAssetModule,
	createApplicationAndAssetBundle,
	unpackApplicationAndAssetBundle,
	updateModuleAssetDependencies,
	sanitizeAddress,
	isAssetValid,
	AssetLimitError,
	createProtectedModule,
	encodeEnvVarsAsset,
	createEnvVarsAssetModule,
	type EnvVarsSnapshot,
	type NamedData,
	type PrefixInput,
	type SuffixInput
} from '../../src/lib/moduleEncoding';
import * as ModuleInfo from '../../src/lib/ModuleInfo';
const { Flags: ModuleFlags, MODULE_PREFIX_SIZE, FunctionType, ModuleInfoExtension } = ModuleInfo;

const TEST_BINARIES_PATH = path.resolve(path.join(__dirname, '../binaries'));

const TEST_ASSETS_PATH = path.resolve(path.join(__dirname, '../assets'));

// Exclude some old and malformed firmware binaries from the test
const EXCLUDED_TEST_BINARIES = new Set([
	'emptybin.bin',
	'RC2_bootloader.bin',
	'RC4_bootloader_pad_BM-09.bin',
	'RC4_bootloader_pad_BM-14.bin'
]);

const TEST_BINARIES = fs
	.readdirSync(TEST_BINARIES_PATH)
	.filter((f) => f.endsWith('.bin') && !EXCLUDED_TEST_BINARIES.has(f))
	.map((f) => path.join(TEST_BINARIES_PATH, f));

const TEST_ASSETS = fs.readdirSync(TEST_ASSETS_PATH).map((f) => path.join(TEST_ASSETS_PATH, f));

const SHA256_OFFSET = 38; // Relative to the end of the module data
const CRC32_OFFSET = 4; // ditto

function genRandomBuffer(size = 1024): Buffer {
	const buf = Buffer.alloc(size);
	for (let i = 0; i < buf.length; ++i) {
		buf[i] = Math.floor(Math.random() * 256);
	}
	return buf;
}

function genModuleBinary({ addVectorTable }: { addVectorTable?: boolean } = {}): Buffer {
	return createFirmwareBinary({
		productId: 0xabcd,
		productVersion: 0x1234,
		platformId: 10,
		addVectorTable
	});
}

async function parseModuleBinary(data: Buffer): Promise<FileInfo> {
	return new HalModuleParser().parseBuffer({ fileBuffer: data });
}

/** Fails the test when there is no matching extension */
function findExtension(
	type: number,
	extensions: ModuleExtension[] | undefined,
	fields: Partial<ModuleExtension> = {}
): ModuleExtension {
	const keys = Object.keys(fields) as (keyof ModuleExtension)[];
	const ext = extensions?.find((candidate) => candidate.type === type && keys.every((k) => candidate[k] === fields[k]));
	if (!ext) {
		throw new Error(`No extension of type ${type} matching ${JSON.stringify(fields)}`);
	}
	return ext;
}

/** @returns A copy of `value` without `keys` at its top level */
function omit(value: object, keys: string[]): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/** @returns A copy of `value` without `keys` in any nested object or array */
function omitDeep(value: unknown, keys: string[]): unknown {
	if (Array.isArray(value)) {
		return value.map((item): unknown => omitDeep(item, keys));
	}
	if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => !keys.includes(key))
				.map(([key, item]): [string, unknown] => [key, omitDeep(item, keys)])
		);
	}
	return value;
}

/** @param keys Ignored at the top level of both objects */
function expectDeepEqualExcluding(actual: object, expected: object, keys: string[]): void {
	expect(omit(actual, keys)).toEqual(omit(expected, keys));
}

/** @param keys Ignored at any depth in both objects */
function expectDeepEqualExcludingEvery(actual: object, expected: object, keys: string[]): void {
	expect(omitDeep(actual, keys)).toEqual(omitDeep(expected, keys));
}

async function validateAsset(mod: Buffer, vars: Record<string, string>, snapshot?: EnvVarsSnapshot): Promise<void> {
	const info = await parseModuleBinary(mod);
	expect(info.crc.ok).toBe(true);
	expect(info.prefixInfo).toMatchObject({
		moduleFunction: ModuleInfo.FunctionType.ASSET,
		moduleFlags: ModuleFlags.DROP_MODULE_INFO // No compression
	});

	const extensions = info.suffixInfo.extensions;
	expect(findExtension(ModuleInfo.ExtensionType.NAME, extensions)).toMatchObject({
		name: 'env'
	});
	expect(findExtension(ModuleInfo.ExtensionType.ASSET_TYPE, extensions)).toMatchObject({
		assetType: snapshot ? ModuleInfo.AssetType.ENV_VARS_SNAPSHOT : ModuleInfo.AssetType.ENV_VARS_APP
	});

	const assetData = await unwrapAssetModule(mod);
	const EnvVars = protobufSchema.system.EnvVars;
	const pbMsg = EnvVars.toObject(EnvVars.decode(assetData), { longs: Number });

	const varEntries = Object.entries(vars);
	expect(pbMsg).toEqual({
		...(varEntries.length > 0 ? { vars: varEntries.map(([name, value]) => ({ name, value })) } : {}),
		...(snapshot
			? {
					hash: Buffer.isBuffer(snapshot.hash) ? snapshot.hash : Buffer.from(snapshot.hash, 'hex'),
					updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.parse(snapshot.updatedAt)
				}
			: {})
	});
}

function readTestApplication(): Buffer {
	return fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
}

function readTestAsset(): Buffer {
	return fs.readFileSync(TEST_ASSETS[0]!);
}

async function zipFiles(files: { name: string; data: Buffer | string }[]): Promise<Buffer> {
	const archive = new ZipArchive();
	for (const { name, data } of files) {
		archive.append(data, { name });
	}
	const [bundle] = await Promise.all([buffer(archive), archive.finalize()]);
	return bundle;
}

describe('moduleEncoding', () => {
	describe('updateModulePrefix()', () => {
		it('can update prefix fields selectively', async () => {
			const bin = genModuleBinary();
			let prefixInfo: PrefixInput = {
				moduleStartAddy: 0x44332211,
				// moduleEndAddy: 0x88776655,
				reserved: 0x99,
				// moduleFlags: 0xaa,
				moduleVersion: 0xccbb,
				// platformID: 0xeedd,
				moduleFunction: 0xff,
				// moduleIndex: 0x11,
				depModuleFunction: 0x22,
				// depModuleIndex: 0x33,
				depModuleVersion: 0x5544,
				// dep2ModuleFunction: 0x66,
				dep2ModuleIndex: 0x77
				// dep2ModuleVersion: 0x9988
			};
			bin.fill(0, 0, MODULE_PREFIX_SIZE);
			updateModulePrefix(bin, prefixInfo);
			let d = bin.subarray(0, MODULE_PREFIX_SIZE);
			expect(d.toString('hex')).toBe('11223344000000009900bbcc0000ff002200445500770000');
			prefixInfo = {
				// moduleStartAddy: 0x44332211,
				moduleEndAddy: 0x88776655,
				// reserved: 0x99,
				moduleFlags: 0xaa,
				// moduleVersion: 0xccbb,
				platformID: 0xeedd,
				// moduleFunction: 0xff,
				moduleIndex: 0x11,
				// depModuleFunction: 0x22,
				depModuleIndex: 0x33,
				// depModuleVersion: 0x5544,
				dep2ModuleFunction: 0x66,
				// dep2ModuleIndex: 0x77,
				dep2ModuleVersion: 0x9988
			};
			bin.fill(0, 0, MODULE_PREFIX_SIZE);
			updateModulePrefix(bin, prefixInfo);
			d = bin.subarray(0, MODULE_PREFIX_SIZE);
			expect(d.toString('hex')).toBe('000000005566778800aa0000ddee00110033000066008899');
		});

		it('correctly updates test module binaries', async () => {
			for (const file of TEST_BINARIES) {
				const origBin = fs.readFileSync(file);
				const { prefixInfo } = await parseModuleBinary(origBin);
				const bin = Buffer.from(origBin);
				bin.fill(0, prefixInfo.prefixOffset, prefixInfo.prefixOffset + prefixInfo.prefixSize);
				updateModulePrefix(bin, prefixInfo);
				expect(bin.equals(origBin)).toBe(true);
			}
		});

		it('does not leak global variables', () => {
			delete (globalThis as Record<string, unknown>).addr;
			updateModulePrefix(genModuleBinary(), { moduleStartAddy: 0x44332211, moduleEndAddy: 0x88776655 });
			expect(Object.hasOwn(globalThis, 'addr')).toBe(false);
		});
	});

	describe('updateModuleSuffix()', () => {
		it('can update suffix fields selectively', async () => {
			const bin = genModuleBinary();
			const suffixSize = 40; // Mandatory
			let suffixInfo: SuffixInput = {
				productId: 0x2211,
				// productVersion: 0x4433,
				reserved: 0x6655,
				// fwUniqueId: '778899aabbccddeeff112233445566778899aabbccddeeff1122334455667788',
				crcBlock: '99aabbcc',
				suffixSize
			};
			const offs = bin.length - suffixSize - 4;
			const size = suffixSize + 4; // Including CRC-32
			bin.fill(0, offs, offs + size);
			updateModuleSuffix(bin, suffixInfo);
			let d = bin.subarray(offs, offs + size);
			expect(d.toString('hex')).toBe(
				'1122000055660000000000000000000000000000000000000000000000000000000000000000280099aabbcc'
			);
			suffixInfo = {
				// productId: 0x2211,
				productVersion: 0x4433,
				// reserved: 0x6655,
				fwUniqueId: '778899aabbccddeeff112233445566778899aabbccddeeff1122334455667788',
				// crcBlock: '99aabbcc',
				suffixSize
			};
			bin.fill(0, offs, offs + size);
			updateModuleSuffix(bin, suffixInfo);
			d = bin.subarray(offs, offs + size);
			expect(d.toString('hex')).toBe(
				'000033440000778899aabbccddeeff112233445566778899aabbccddeeff1122334455667788280000000000'
			);
		});

		it('correctly updates test module binaries', async () => {
			for (const file of TEST_BINARIES) {
				const origBin = fs.readFileSync(file);
				const { suffixInfo } = await parseModuleBinary(origBin);
				const bin = Buffer.from(origBin);
				const offs = bin.length - suffixInfo.suffixSize - 4;
				const size = suffixInfo.suffixSize + 4; // Including CRC-32
				bin.fill(0, offs, offs + size);
				updateModuleSuffix(bin, suffixInfo);
				expect(bin.equals(origBin)).toBe(true);
			}
		});
	});

	describe('compressModule() and decompressModule()', () => {
		it('compress and decompress a module binary', async () => {
			const bin = genModuleBinary();
			const comp = await compressModule(bin);
			expect(comp.length).toBeLessThan(bin.length);
			const decomp = await decompressModule(comp);
			expect(decomp.equals(bin)).toBe(true);
		});

		it("set and clear COMPRESSED flag in the module's prefix info", async () => {
			const bin = genModuleBinary();
			let prefix = (await parseModuleBinary(bin)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMPRESSED).toBe(0);
			const comp = await compressModule(bin);
			prefix = (await parseModuleBinary(comp)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMPRESSED).not.toBe(0);
			const decomp = await decompressModule(comp);
			prefix = (await parseModuleBinary(decomp)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMPRESSED).toBe(0);
		});

		it('encode the header of the compressed data correctly', async () => {
			const bin = genModuleBinary();
			const comp = await compressModule(bin, {
				zlib: {
					windowBits: 14
				}
			});
			const header = Buffer.alloc(8); // Expected header data
			let offs = 0;
			offs = header.writeUInt16LE(8, offs); // Header size
			offs = header.writeUInt8(0, offs); // Compression method
			offs = header.writeUInt8(14, offs); // Window size
			offs = header.writeUInt32LE(bin.length, offs); // Original size
			const h = comp.subarray(MODULE_PREFIX_SIZE, MODULE_PREFIX_SIZE + header.length);
			expect(h.equals(header)).toBe(true);
		});

		it('produce a compressed module with valid checksums', async () => {
			const bin = genModuleBinary();
			const comp = await compressModule(bin);
			const hash = crypto
				.createHash('sha256')
				.update(comp.subarray(0, comp.length - SHA256_OFFSET))
				.digest();
			const crc = crc32(comp.subarray(0, comp.length - CRC32_OFFSET));
			const info = await parseModuleBinary(comp);
			expect(info.suffixInfo.fwUniqueId).toBe(hash.toString('hex'));
			expect(info.suffixInfo.crcBlock).toBe(crc.toString('hex'));
			expect(info.crc.ok).toBeTruthy();
		});

		it('can optionally preserve original module checksums', async () => {
			const bin = genModuleBinary();
			let offs = bin.length - SHA256_OFFSET;
			bin.fill(0x11, offs, offs + 32);
			offs = bin.length - CRC32_OFFSET;
			bin.fill(0x22, offs, offs + 4);
			const comp = await compressModule(bin, {
				updateSha256: false,
				updateCrc32: false
			});
			const { suffixInfo } = await parseModuleBinary(comp);
			expect(suffixInfo.fwUniqueId).toBe('11'.repeat(32));
			expect(suffixInfo.crcBlock).toBe('22'.repeat(4));
		});

		it('compress and decompress test module binaries successfully', async () => {
			for (const file of TEST_BINARIES) {
				const orig = fs.readFileSync(file);
				const comp = await compressModule(orig);
				expect(comp.length).toBeLessThan(orig.length);
				const decomp = await decompressModule(comp);
				expect(decomp.equals(orig)).toBe(true);
			}
		});
	});

	describe('combineModules() and splitCombinedModules()', () => {
		it('combine and split module binaries', async () => {
			const bin1 = genModuleBinary();
			const bin2 = genModuleBinary();
			const comb = await combineModules([bin1, bin2]);
			expect(comb.length).toBe(bin1.length + bin2.length);
			const uncomb = await splitCombinedModules(comb);
			expect(uncomb[0]!.equals(bin1)).toBe(true);
			expect(uncomb[1]!.equals(bin2)).toBe(true);
		});

		it('set and clear COMBINED flag on all modules except the last one', async () => {
			// Combine 3 modules
			const bin1 = genModuleBinary();
			let prefix = (await parseModuleBinary(bin1)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMBINED).toBe(0);
			const bin2 = genModuleBinary();
			prefix = (await parseModuleBinary(bin2)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMBINED).toBe(0);
			const bin3 = genModuleBinary();
			prefix = (await parseModuleBinary(bin3)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMBINED).toBe(0);
			const comb = await combineModules([bin1, bin2, bin3]);
			// Check 1st module
			let buf = comb.subarray(0, bin1.length);
			prefix = (await parseModuleBinary(buf)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMBINED).not.toBe(0);
			// Check 2nd module
			buf = comb.subarray(bin1.length, bin1.length + bin2.length);
			prefix = (await parseModuleBinary(buf)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMBINED).not.toBe(0);
			// Check 3rd module
			buf = comb.subarray(bin1.length + bin2.length, bin1.length + bin2.length + bin3.length);
			prefix = (await parseModuleBinary(buf)).prefixInfo;
			expect(prefix.moduleFlags & ModuleFlags.COMBINED).toBe(0);
		});

		it('update checksums of combined modules', async () => {
			const bin1 = genModuleBinary();
			const bin2 = genModuleBinary();
			const comb = await combineModules([bin1, bin2]);
			// 1st module
			let buf = comb.subarray(0, bin1.length);
			let hash = crypto
				.createHash('sha256')
				.update(buf.subarray(0, buf.length - SHA256_OFFSET))
				.digest();
			let crc = crc32(buf.subarray(0, buf.length - CRC32_OFFSET));
			let info = await parseModuleBinary(buf);
			expect(info.suffixInfo.fwUniqueId).toBe(hash.toString('hex'));
			expect(info.suffixInfo.crcBlock).toBe(crc.toString('hex'));
			expect(info.crc.ok).toBeTruthy();
			// 2nd module
			buf = comb.subarray(bin1.length, bin1.length + bin2.length);
			hash = crypto
				.createHash('sha256')
				.update(buf.subarray(0, buf.length - SHA256_OFFSET))
				.digest();
			crc = crc32(buf.subarray(0, buf.length - CRC32_OFFSET));
			info = await parseModuleBinary(buf);
			expect(info.suffixInfo.fwUniqueId).toBe(hash.toString('hex'));
			expect(info.suffixInfo.crcBlock).toBe(crc.toString('hex'));
			expect(info.crc.ok).toBeTruthy();
		});

		it('can optionally preserve original module checksums', async () => {
			const bin1 = genModuleBinary();
			bin1.fill(0x11, bin1.length - SHA256_OFFSET, bin1.length - SHA256_OFFSET + 32);
			bin1.fill(0x22, bin1.length - CRC32_OFFSET, bin1.length - CRC32_OFFSET + 4);
			const bin2 = genModuleBinary();
			bin2.fill(0x33, bin2.length - SHA256_OFFSET, bin2.length - SHA256_OFFSET + 32);
			bin2.fill(0x44, bin2.length - CRC32_OFFSET, bin2.length - CRC32_OFFSET + 4);
			const comb = await combineModules([bin1, bin2], {
				updateSha256: false,
				updateCrc32: false
			});
			const uncomb = await splitCombinedModules(comb, {
				updateSha256: false,
				updateCrc32: false
			});
			let { suffixInfo } = await parseModuleBinary(uncomb[0]!);
			expect(suffixInfo.fwUniqueId).toBe('11'.repeat(32));
			expect(suffixInfo.crcBlock).toBe('22'.repeat(4));
			({ suffixInfo } = await parseModuleBinary(uncomb[1]!));
			expect(suffixInfo.fwUniqueId).toBe('33'.repeat(32));
			expect(suffixInfo.crcBlock).toBe('44'.repeat(4));
		});

		it('combine and split test module binaries successfully', async () => {
			const orig = [];
			const maxFiles = 10;
			let count = 0;
			for (const file of TEST_BINARIES) {
				const d = fs.readFileSync(file);
				orig.push(d);
				if (++count >= maxFiles) {
					break;
				}
			}
			const comb = await combineModules(orig);
			const uncomb = await splitCombinedModules(comb);
			expect(uncomb.length).toBe(orig.length);
			for (const [i, mod] of uncomb.entries()) {
				expect(mod.equals(orig[i]!)).toBe(true);
			}
		});

		it('combine and split compressed module binaries successfully', async () => {
			const orig = [];
			const maxFiles = 5;
			let count = 0;
			for (const file of TEST_BINARIES) {
				const d = fs.readFileSync(file);
				orig.push(d);
				if (++count >= maxFiles) {
					break;
				}
			}
			const comp = [];
			for (const d of orig) {
				comp.push(await compressModule(d));
			}
			const comb = await combineModules(comp);
			const uncomb = await splitCombinedModules(comb);
			const uncomp = [];
			for (const d of uncomb) {
				uncomp.push(await decompressModule(d));
			}
			expect(uncomp.length).toBe(orig.length);
			for (const [i, mod] of uncomp.entries()) {
				expect(mod.equals(orig[i]!)).toBe(true);
			}
		});
	});

	describe('updateModuleSha256()', () => {
		it('updates the SHA-256 checksum of a module', async () => {
			const bin = genModuleBinary();
			const offs = bin.length - SHA256_OFFSET;
			const hash = crypto.createHash('sha256').update(bin.subarray(0, offs)).digest();
			bin.fill(0, offs, offs + 32);
			updateModuleSha256(bin);
			const { suffixInfo } = await parseModuleBinary(bin);
			expect(suffixInfo.fwUniqueId).toBe(hash.toString('hex'));
		});
	});

	describe('updateModuleCrc32()', () => {
		it('updates the CRC-32 checksum of a module', async () => {
			const bin = genModuleBinary();
			const offs = bin.length - CRC32_OFFSET;
			const crc = crc32(bin.subarray(0, offs));
			bin.fill(0, offs, offs + 4);
			updateModuleCrc32(bin);
			const { suffixInfo } = await parseModuleBinary(bin);
			expect(suffixInfo.crcBlock).toBe(crc.toString('hex'));
		});

		describe('given that a custom CRC-32 function is provided globally', () => {
			let defaultCrc32: Config['crc32'];

			beforeAll(() => {
				defaultCrc32 = config().crc32;
			});

			afterEach(() => {
				config({ crc32: defaultCrc32 });
			});

			it('uses that function for CRC-32 computations', async () => {
				const bin = genModuleBinary();
				bin.fill(0, bin.length - CRC32_OFFSET);
				const dummyCrc = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
				config({ crc32: () => dummyCrc });
				updateModuleCrc32(bin);
				const { suffixInfo } = await parseModuleBinary(bin);
				expect(suffixInfo.crcBlock).toBe(dummyCrc.toString('hex'));
			});
		});
	});

	describe('asset management', () => {
		it('wraps asset file into a module and unwraps it back to original successfully', async () => {
			for (const file of TEST_ASSETS) {
				const origAsset = Buffer.from(fs.readFileSync(file));
				const bin = await createAssetModule(origAsset, path.basename(file));
				expect(bin.equals(origAsset)).toBe(false);
				const info = await parseModuleBinary(bin);
				expect(info.prefixInfo.moduleFunction).toBe(FunctionType.ASSET);
				expect(info.crc.ok).toBe(true);
				// Check name and hash
				expect(info.suffixInfo.extensions?.length).toBeGreaterThan(1);
				let name = null;
				let hash = null;
				for (const ext of info.suffixInfo.extensions ?? []) {
					if (ext.type === ModuleInfoExtension.NAME) {
						name = ext.name;
					} else if (ext.type === ModuleInfoExtension.HASH) {
						hash = ext.hash;
					}
				}
				expect(name).toBe(path.basename(file));
				expect(hash).not.toBe(null);
				// Compressed by default
				expect(info.prefixInfo.moduleFlags).toBe(ModuleFlags.COMPRESSED | ModuleFlags.DROP_MODULE_INFO);
				expect(bin.length).toBeLessThan(origAsset.length);
				// Unwrap
				const unwrapped = await unwrapAssetModule(bin);
				expect(unwrapped.equals(origAsset)).toBe(true);
			}
		});

		it('wraps asset file into a module and unwraps it back to original successfully with compression disabled', async () => {
			for (const file of TEST_ASSETS) {
				const origAsset = Buffer.from(fs.readFileSync(file));
				const bin = await createAssetModule(origAsset, path.basename(file), { compress: false });
				expect(bin.equals(origAsset)).toBe(false);
				const info = await parseModuleBinary(bin);
				expect(info.prefixInfo.moduleFunction).toBe(FunctionType.ASSET);
				expect(info.crc.ok).toBe(true);
				// Check name and hash
				expect(info.suffixInfo.extensions?.length).toBeGreaterThan(1);
				let name = null;
				let hash = null;
				for (const ext of info.suffixInfo.extensions ?? []) {
					if (ext.type === ModuleInfoExtension.NAME) {
						name = ext.name;
					} else if (ext.type === ModuleInfoExtension.HASH) {
						hash = ext.hash;
					}
				}
				expect(name).toBe(path.basename(file));
				expect(hash).not.toBe(null);
				// Not compressed in this case
				expect(info.prefixInfo.moduleFlags).toBe(ModuleFlags.DROP_MODULE_INFO);
				expect(bin.length).toBeGreaterThan(origAsset.length);
				// Unwrap
				const unwrapped = await unwrapAssetModule(bin);
				expect(unwrapped.equals(origAsset)).toBe(true);
			}
		});

		it('adds asset dependencies to P2 user appplication', async () => {
			const assets = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'p2-tinker@5.3.1.bin'));
			const applicationWithAssets = await updateModuleAssetDependencies(application, assets);
			expect(applicationWithAssets.length).toBeGreaterThan(application.length);
			const infoApplication = await parseModuleBinary(application);
			const infoApplicationWithAssets = await parseModuleBinary(applicationWithAssets);
			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoApplication.suffixInfo, infoApplicationWithAssets.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'moduleStartAddress',
				'data'
			]);
			expectDeepEqualExcluding(infoApplication.prefixInfo, infoApplicationWithAssets.prefixInfo, [
				'moduleStartAddy',
				'extensions',
				'prefixSize',
				'moduleFlags'
			]);
			// P2 (RTL872x) applications grow left
			expect(sanitizeAddress(infoApplicationWithAssets.prefixInfo.moduleStartAddy)).toBeLessThan(
				sanitizeAddress(infoApplication.prefixInfo.moduleStartAddy)
			);
			// DYNAMIC_LOCATION extensions has been updated
			expect(
				findExtension(ModuleInfoExtension.DYNAMIC_LOCATION, infoApplicationWithAssets.suffixInfo.extensions)
					.moduleStartAddress
			).toBe(infoApplicationWithAssets.prefixInfo.moduleStartAddy);
			expect(infoApplicationWithAssets.prefixInfo.extensions?.length).toBeGreaterThan(assets.length);
			for (const asset of assets) {
				const ext = findExtension(
					ModuleInfoExtension.ASSET_DEPENDENCY,
					infoApplicationWithAssets.prefixInfo.extensions,
					{ name: asset.name }
				);
				expect(ext).toBeDefined();
				expect(ext.name).toBe(asset.name);
				const wrapped = await createAssetModule(asset.data, asset.name);
				const wrappedInfo = await parseModuleBinary(wrapped);
				const wrappedHash = findExtension(ModuleInfoExtension.HASH, wrappedInfo.suffixInfo.extensions);
				expect(wrappedHash).toBeDefined();
				expect(wrappedHash.hash).toBe(ext.hash);
			}
		});

		it('adds asset dependencies to Tracker user appplication', async () => {
			const assets = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const applicationWithAssets = await updateModuleAssetDependencies(application, assets);
			expect(applicationWithAssets.length).toBeGreaterThan(application.length);
			const infoApplication = await parseModuleBinary(application);
			const infoApplicationWithAssets = await parseModuleBinary(applicationWithAssets);
			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoApplication.suffixInfo, infoApplicationWithAssets.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'extensions',
				'suffixSize'
			]);
			expectDeepEqualExcluding(infoApplication.prefixInfo, infoApplicationWithAssets.prefixInfo, [
				'moduleEndAddy',
				'prefixSize',
				'moduleFlags'
			]);
			// Tracker (nRF52840) applications grow right
			expect(sanitizeAddress(infoApplicationWithAssets.prefixInfo.moduleEndAddy)).toBeGreaterThan(
				sanitizeAddress(infoApplication.prefixInfo.moduleEndAddy)
			);
			expect(infoApplicationWithAssets.suffixInfo.extensions?.length).toBeGreaterThan(assets.length);
			for (const asset of assets) {
				const ext = findExtension(
					ModuleInfoExtension.ASSET_DEPENDENCY,
					infoApplicationWithAssets.suffixInfo.extensions,
					{ name: asset.name }
				);
				expect(ext).toBeDefined();
				expect(ext.name).toBe(asset.name);
				const wrapped = await createAssetModule(asset.data, asset.name);
				const wrappedInfo = await parseModuleBinary(wrapped);
				const wrappedHash = findExtension(ModuleInfoExtension.HASH, wrappedInfo.suffixInfo.extensions);
				expect(wrappedHash).toBeDefined();
				expect(wrappedHash.hash).toBe(ext.hash);
			}
		});

		it('adds asset dependencies to P2 user appplication using asset modules (wrapped)', async () => {
			let assets: NamedData[] = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			assets = await Promise.all(
				assets.map(async (asset) => {
					const module = await createAssetModule(Buffer.from(asset.data), asset.name);
					return {
						data: module,
						name: asset.name
					};
				})
			);
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'p2-tinker@5.3.1.bin'));
			const applicationWithAssets = await updateModuleAssetDependencies(application, assets);
			expect(applicationWithAssets.length).toBeGreaterThan(application.length);
			const infoApplication = await parseModuleBinary(application);
			const infoApplicationWithAssets = await parseModuleBinary(applicationWithAssets);
			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoApplication.suffixInfo, infoApplicationWithAssets.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'moduleStartAddress',
				'data'
			]);
			expectDeepEqualExcluding(infoApplication.prefixInfo, infoApplicationWithAssets.prefixInfo, [
				'moduleStartAddy',
				'extensions',
				'prefixSize',
				'moduleFlags'
			]);
			// P2 (RTL872x) applications grow left
			expect(sanitizeAddress(infoApplicationWithAssets.prefixInfo.moduleStartAddy)).toBeLessThan(
				sanitizeAddress(infoApplication.prefixInfo.moduleStartAddy)
			);
			// DYNAMIC_LOCATION extensions has been updated
			expect(
				findExtension(ModuleInfoExtension.DYNAMIC_LOCATION, infoApplicationWithAssets.suffixInfo.extensions)
					.moduleStartAddress
			).toBe(infoApplicationWithAssets.prefixInfo.moduleStartAddy);
			expect(infoApplicationWithAssets.prefixInfo.extensions?.length).toBeGreaterThan(assets.length);
			for (const asset of assets) {
				const ext = findExtension(
					ModuleInfoExtension.ASSET_DEPENDENCY,
					infoApplicationWithAssets.prefixInfo.extensions,
					{ name: asset.name }
				);
				expect(ext).toBeDefined();
				expect(ext.name).toBe(asset.name);
				const wrapped = asset.data;
				const wrappedInfo = await parseModuleBinary(wrapped);
				const wrappedHash = findExtension(ModuleInfoExtension.HASH, wrappedInfo.suffixInfo.extensions);
				expect(wrappedHash).toBeDefined();
				expect(wrappedHash.hash).toBe(ext.hash);
			}
		});

		it('adds asset dependencies to Tracker user appplication using asset modules (wrapped)', async () => {
			let assets: NamedData[] = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			assets = await Promise.all(
				assets.map(async (asset) => {
					const module = await createAssetModule(Buffer.from(asset.data), asset.name);
					return {
						data: module,
						name: asset.name
					};
				})
			);
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const applicationWithAssets = await updateModuleAssetDependencies(application, assets);
			expect(applicationWithAssets.length).toBeGreaterThan(application.length);
			const infoApplication = await parseModuleBinary(application);
			const infoApplicationWithAssets = await parseModuleBinary(applicationWithAssets);
			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoApplication.suffixInfo, infoApplicationWithAssets.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'extensions',
				'suffixSize'
			]);
			expectDeepEqualExcluding(infoApplication.prefixInfo, infoApplicationWithAssets.prefixInfo, [
				'moduleEndAddy',
				'prefixSize',
				'moduleFlags'
			]);
			// Tracker (nRF52840) applications grow right
			expect(sanitizeAddress(infoApplicationWithAssets.prefixInfo.moduleEndAddy)).toBeGreaterThan(
				sanitizeAddress(infoApplication.prefixInfo.moduleEndAddy)
			);
			expect(infoApplicationWithAssets.suffixInfo.extensions?.length).toBeGreaterThan(assets.length);
			for (const asset of assets) {
				const ext = findExtension(
					ModuleInfoExtension.ASSET_DEPENDENCY,
					infoApplicationWithAssets.suffixInfo.extensions,
					{ name: asset.name }
				);
				expect(ext).toBeDefined();
				expect(ext.name).toBe(asset.name);
				const wrapped = asset.data;
				const wrappedInfo = await parseModuleBinary(wrapped);
				const wrappedHash = findExtension(ModuleInfoExtension.HASH, wrappedInfo.suffixInfo.extensions);
				expect(wrappedHash).toBeDefined();
				expect(wrappedHash.hash).toBe(ext.hash);
			}
		});

		it('creates application and assets bundle for P2 user application from Buffers', async () => {
			const assets = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'p2-tinker@5.3.1.bin'));
			const app = { data: application, name: 'testapp.bin' };
			const bundle = await createApplicationAndAssetBundle(app, assets);
			const unpacked = await unpackApplicationAndAssetBundle(bundle);
			expect(unpacked.application?.data.equals(application)).toBe(false);
			expect(unpacked.application?.name).toBe(app.name);
			expect(unpacked.assets).toEqual(assets);
		});

		it('creates application and assets bundle for P2 user application from paths', async () => {
			const assets = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'p2-tinker@5.3.1.bin'));
			const app = path.join(TEST_BINARIES_PATH, 'p2-tinker@5.3.1.bin');
			const bundle = await createApplicationAndAssetBundle(app, TEST_ASSETS);
			const unpacked = await unpackApplicationAndAssetBundle(bundle);
			expect(unpacked.application?.data.equals(application)).toBe(false);
			expect(unpacked.application?.name).toBe(path.basename(app));
			expect(unpacked.assets).toEqual(assets);
		});

		it('creates application and assets bundle for Tracker user application from Buffers', async () => {
			const assets = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const app = { data: application, name: 'testapp.bin' };
			const bundle = await createApplicationAndAssetBundle(app, assets);
			const unpacked = await unpackApplicationAndAssetBundle(bundle);
			expect(unpacked.application?.data.equals(application)).toBe(false);
			expect(unpacked.application?.name).toBe(app.name);
			expect(unpacked.assets).toEqual(assets);
		});

		it('creates application and assets bundle for Tracker user application from paths', async () => {
			const assets = TEST_ASSETS.map((f) => {
				return { data: fs.readFileSync(f), name: path.basename(f) };
			});
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const app = path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin');
			const bundle = await createApplicationAndAssetBundle(app, TEST_ASSETS);
			const unpacked = await unpackApplicationAndAssetBundle(bundle);
			expect(unpacked.application?.data.equals(application)).toBe(false);
			expect(unpacked.application?.name).toBe(path.basename(app));
			expect(unpacked.assets).toEqual(assets);
		});

		it('creates application bundle when there are no assets', async () => {
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const app = path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin');
			const bundle = await createApplicationAndAssetBundle(app, []);
			const unpacked = await unpackApplicationAndAssetBundle(bundle);
			expect(unpacked.application?.data.equals(application)).toBe(true);
			expect(unpacked.application?.name).toBe(path.basename(app));
			expect(unpacked.assets).toEqual([]);
		});

		it('throws an error when application binary with added asset dependencies exceeds platform size limit', async () => {
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-max-size@5.5.0-rc.1.bin'));
			const assets = [];
			for (let i = 0; i < 100; i++) {
				assets.push({
					data: genRandomBuffer(1),
					name: genRandomBuffer(127).toString('hex')
				});
			}
			const result = createApplicationAndAssetBundle(application, assets);
			await expect(result).rejects.toThrow(AssetLimitError);
			await expect(result).rejects.toThrow('Resulting module exceeds platform size limits');
		});

		it('throws an error when asset exceeds maximum single asset size limit on Tracker platform', async () => {
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const result = createApplicationAndAssetBundle(application, [
				{ data: genRandomBuffer(10 * 1024 * 1024), name: 'test.bin' }
			]);
			await expect(result).rejects.toThrow(AssetLimitError);
			await expect(result).rejects.toThrow(/maximum single asset size limit/);
		});

		it('throws an error when assets exceed total maximum size of assets on Tracker platform', async () => {
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const assets = [];
			for (let i = 0; i < 10; i++) {
				assets.push({
					data: genRandomBuffer(400 * 1024),
					name: genRandomBuffer(127).toString('hex')
				});
			}
			const result = createApplicationAndAssetBundle(application, assets);
			await expect(result).rejects.toThrow(AssetLimitError);
			await expect(result).rejects.toThrow(/Total size of assets exceeds/);
		});

		it('includes env vars into the bundle', async () => {
			const vars = { KEY: 'value' };
			const app = path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin');
			const bundle = await createApplicationAndAssetBundle(app, [], vars);
			const unpacked = await unpackApplicationAndAssetBundle(bundle);
			expect(unpacked.env?.data).toEqual(vars);
			expect(unpacked.assets.length).toEqual(1);
		});

		it('rejects a bundle with more than one application', async () => {
			const application = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin'));
			const archive = new ZipArchive();
			archive.append(application, { name: 'one.bin' });
			archive.append(application, { name: 'two.bin' });
			const [bundle] = await Promise.all([buffer(archive), archive.finalize()]);
			await expect(unpackApplicationAndAssetBundle(bundle)).rejects.toThrow(
				new RangeError('More applications than expected in a bundle')
			);
		});

		describe('unpacking bundles made by other tools', () => {
			it('skips directory entries', async () => {
				const bundle = await zipFiles([
					{ name: 'assets/', data: '' },
					{ name: 'app.bin', data: readTestApplication() },
					{ name: 'assets/a.bin', data: readTestAsset() }
				]);
				const unpacked = await unpackApplicationAndAssetBundle(bundle);
				expect(unpacked.application?.data).toEqual(readTestApplication());
				expect(unpacked.assets).toEqual([{ name: 'a.bin', data: readTestAsset() }]);
			});

			it('ignores files outside the root and assets/, and other root files', async () => {
				const bundle = await zipFiles([
					{ name: 'README.txt', data: 'readme' },
					{ name: 'app.bin', data: readTestApplication() },
					{ name: 'other/thing.bin', data: 'x' },
					{ name: 'assets/sub/nested.bin', data: 'y' },
					{ name: 'assets/a.bin', data: readTestAsset() },
					{ name: 'manifest.json', data: '{}' }
				]);
				const unpacked = await unpackApplicationAndAssetBundle(bundle);
				expect(unpacked.application).toEqual({ name: 'app.bin', data: readTestApplication() });
				expect(unpacked.assets).toEqual([{ name: 'a.bin', data: readTestAsset() }]);
				expect(unpacked.env).toBeUndefined();
			});

			it('reads env.json wherever it is in the bundle', async () => {
				const bundle = await zipFiles([
					{ name: 'env.json', data: '{"A":"b"}' },
					{ name: 'assets/a.bin', data: readTestAsset() },
					{ name: 'app.bin', data: readTestApplication() }
				]);
				const unpacked = await unpackApplicationAndAssetBundle(bundle);
				expect(unpacked.env).toEqual({ name: 'env.json', data: { A: 'b' } });
				expect(unpacked.application?.name).toBe('app.bin');
			});

			it('rejects an invalid env.json', async () => {
				const bundle = await zipFiles([
					{ name: 'app.bin', data: readTestApplication() },
					{ name: 'env.json', data: '{not json' }
				]);
				await expect(unpackApplicationAndAssetBundle(bundle)).rejects.toThrow(/^Env file at env\.json is invalid: /);
			});

			it('unpacks an empty bundle to nothing', async () => {
				await expect(unpackApplicationAndAssetBundle(await zipFiles([]))).resolves.toEqual({ assets: [] });
			});

			it('rejects data that is not a zip', async () => {
				await expect(unpackApplicationAndAssetBundle(readTestApplication())).rejects.toThrow(/invalid signature/);
			});
		});

		it('rejects a truncated bundle', async () => {
			const app = path.join(TEST_BINARIES_PATH, 'tracker-tinker@5.3.1.bin');
			const bundle = await createApplicationAndAssetBundle(app, TEST_ASSETS);
			const truncated = bundle.subarray(0, Math.floor(bundle.length / 2));
			await expect(unpackApplicationAndAssetBundle(truncated)).rejects.toThrow('FILE_ENDED');
		});

		it('rejects when the bundle file does not exist', async () => {
			await expect(unpackApplicationAndAssetBundle(path.join(TEST_BINARIES_PATH, 'missing.zip'))).rejects.toThrow(
				/ENOENT/
			);
		});
	});

	describe('isAssetValid', () => {
		it('returns true if the asset binary matches the hash', async () => {
			const asset = await fs.promises.readFile(TEST_ASSETS[0]!);
			const assetInfo = {
				type: ModuleInfo.ModuleInfoExtension.ASSET_DEPENDENCY,
				hashType: ModuleInfo.ModuleInfoHashExtensionType.SHA256,
				hash: crypto.createHash('sha256').update(asset).digest('hex'),
				name: path.basename(TEST_ASSETS[0]!)
			};

			expect(isAssetValid(asset, assetInfo)).toBe(true);
		});

		it('returns false if the asset binary does not match the hash', async () => {
			const asset = await fs.promises.readFile(TEST_ASSETS[0]!);
			const assetInfo = {
				type: ModuleInfo.ModuleInfoExtension.ASSET_DEPENDENCY,
				hashType: ModuleInfo.ModuleInfoHashExtensionType.SHA256,
				hash: 'eac63541cfbeba37b8ec819b73c16b7f193c6cacbb810cdba1b3a49809dff5d0',
				name: path.basename(TEST_ASSETS[0]!)
			};

			expect(isAssetValid(asset, assetInfo)).toBe(false);
		});

		it('throws if the hash type is unknown', async () => {
			const asset = await fs.promises.readFile(TEST_ASSETS[0]!);
			const assetInfo = {
				type: ModuleInfo.ModuleInfoExtension.ASSET_DEPENDENCY,
				hashType: ModuleInfo.ModuleInfoHashExtensionType.SHA256 + 1,
				hash: 'eac63541cfbeba37b8ec819b73c16b7f193c6cacbb810cdba1b3a49809dff5d0',
				name: path.basename(TEST_ASSETS[0]!)
			};

			expect(() => isAssetValid(asset, assetInfo)).toThrow(new Error('Invalid asset hash type'));
		});
	});

	describe('security mode', () => {
		it('adds security extension with protected mode to P2 bootloader', async () => {
			const bootloader = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'p2-bootloader@5.6.0.bin'));
			const protectedBootloader = await createProtectedModule(bootloader);

			expect(protectedBootloader.length).toBeGreaterThan(bootloader.length);
			const infoBootloader = await parseModuleBinary(bootloader);
			const infoProtectedBootloader = await parseModuleBinary(protectedBootloader);

			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoBootloader.suffixInfo, infoProtectedBootloader.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'extensions',
				'suffixSize'
			]);
			expectDeepEqualExcluding(infoBootloader.prefixInfo, infoProtectedBootloader.prefixInfo, ['moduleEndAddy']);
			// P2 (RTL872x) bootloader grow right
			expect(sanitizeAddress(infoProtectedBootloader.prefixInfo.moduleEndAddy)).toBeGreaterThan(
				sanitizeAddress(infoBootloader.prefixInfo.moduleEndAddy)
			);
			expect(infoProtectedBootloader.suffixInfo.extensions?.length).toBe(
				infoBootloader.suffixInfo.extensions!.length + 1
			);

			const ext = findExtension(ModuleInfoExtension.SECURITY_MODE, infoProtectedBootloader.suffixInfo.extensions);
			expectDeepEqualExcluding(
				ext,
				{
					type: ModuleInfo.ModuleInfoExtension.SECURITY_MODE,
					length: 5,
					securityMode: ModuleInfo.ModuleInfoSecurityMode.PROTECTED
				},
				['data', 'offset']
			);
			expect(infoProtectedBootloader.security?.mode).toBe(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
		});

		it('adds security extension with protected mode to Tracker bootloader', async () => {
			const bootloader = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-bootloader@5.6.0.bin'));
			const protectedBootloader = await createProtectedModule(bootloader);

			expect(protectedBootloader.length).toBeGreaterThan(bootloader.length);
			const infoBootloader = await parseModuleBinary(bootloader);
			const infoProtectedBootloader = await parseModuleBinary(protectedBootloader);

			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoBootloader.suffixInfo, infoProtectedBootloader.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'extensions',
				'suffixSize'
			]);
			expectDeepEqualExcluding(infoBootloader.prefixInfo, infoProtectedBootloader.prefixInfo, ['moduleEndAddy']);
			// Tracker (nRF52840) bootloader grow right
			expect(sanitizeAddress(infoProtectedBootloader.prefixInfo.moduleEndAddy)).toBeGreaterThan(
				sanitizeAddress(infoBootloader.prefixInfo.moduleEndAddy)
			);
			expect(infoProtectedBootloader.suffixInfo.extensions?.length).toBe(2);

			const ext = findExtension(ModuleInfoExtension.SECURITY_MODE, infoProtectedBootloader.suffixInfo.extensions);
			expectDeepEqualExcluding(
				ext,
				{
					type: ModuleInfo.ModuleInfoExtension.SECURITY_MODE,
					length: 5,
					securityMode: ModuleInfo.ModuleInfoSecurityMode.PROTECTED
				},
				['data', 'offset']
			);
			expect(infoProtectedBootloader.security?.mode).toBe(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
		});

		it('adds security extension with protected mode and certificate to P2 bootloader', async () => {
			const bootloader = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'p2-bootloader@5.6.0.bin'));
			const cert = genRandomBuffer(300);
			const protectedBootloader = await createProtectedModule(bootloader, cert);

			expect(protectedBootloader.length).toBeGreaterThan(bootloader.length);
			const infoBootloader = await parseModuleBinary(bootloader);
			const infoProtectedBootloader = await parseModuleBinary(protectedBootloader);

			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoBootloader.suffixInfo, infoProtectedBootloader.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'extensions',
				'suffixSize'
			]);
			expectDeepEqualExcluding(infoBootloader.prefixInfo, infoProtectedBootloader.prefixInfo, ['moduleEndAddy']);
			// P2 (RTL872x) bootloader grow right
			expect(sanitizeAddress(infoProtectedBootloader.prefixInfo.moduleEndAddy)).toBeGreaterThan(
				sanitizeAddress(infoBootloader.prefixInfo.moduleEndAddy)
			);
			expect(infoProtectedBootloader.suffixInfo.extensions?.length).toBe(
				infoBootloader.suffixInfo.extensions!.length + 1
			);

			const ext = findExtension(ModuleInfoExtension.SECURITY_MODE, infoProtectedBootloader.suffixInfo.extensions);
			expectDeepEqualExcluding(
				ext,
				{
					type: ModuleInfo.ModuleInfoExtension.SECURITY_MODE,
					length: 5 + cert.length,
					securityMode: ModuleInfo.ModuleInfoSecurityMode.PROTECTED,
					certificate: cert
				},
				['data', 'offset']
			);
			expect(infoProtectedBootloader.security?.mode).toBe(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
			expect(infoProtectedBootloader.security?.certificate).toEqual(cert);
		});

		it('adds security extension with protected mode and certificate to Tracker bootloader', async () => {
			const bootloader = fs.readFileSync(path.join(TEST_BINARIES_PATH, 'tracker-bootloader@5.6.0.bin'));
			const cert = genRandomBuffer(300);
			const protectedBootloader = await createProtectedModule(bootloader, cert);

			expect(protectedBootloader.length).toBeGreaterThan(bootloader.length);
			const infoBootloader = await parseModuleBinary(bootloader);
			const infoProtectedBootloader = await parseModuleBinary(protectedBootloader);

			// Check some common fields which should be the same
			expectDeepEqualExcludingEvery(infoBootloader.suffixInfo, infoProtectedBootloader.suffixInfo, [
				'crcBlock',
				'fwUniqueId',
				'offset',
				'extensions',
				'suffixSize'
			]);
			expectDeepEqualExcluding(infoBootloader.prefixInfo, infoProtectedBootloader.prefixInfo, ['moduleEndAddy']);
			// Tracker (nRF52840) bootloader grow right
			expect(sanitizeAddress(infoProtectedBootloader.prefixInfo.moduleEndAddy)).toBeGreaterThan(
				sanitizeAddress(infoBootloader.prefixInfo.moduleEndAddy)
			);
			expect(infoProtectedBootloader.suffixInfo.extensions?.length).toBe(2);

			const ext = findExtension(ModuleInfoExtension.SECURITY_MODE, infoProtectedBootloader.suffixInfo.extensions);
			expectDeepEqualExcluding(
				ext,
				{
					type: ModuleInfo.ModuleInfoExtension.SECURITY_MODE,
					length: 5 + cert.length,
					securityMode: ModuleInfo.ModuleInfoSecurityMode.PROTECTED,
					certificate: cert
				},
				['data', 'offset']
			);
			expect(infoProtectedBootloader.security?.mode).toBe(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
			expect(infoProtectedBootloader.security?.certificate).toEqual(cert);
		});
	});

	describe('createEnvVarsAssetModule', () => {
		// oxlint-disable-next-line vitest/expect-expect
		it('can encode user variables', async () => {
			const vars = {
				VAR1: 'abc',
				VAR2: '123'
			};
			const mod = await createEnvVarsAssetModule(vars);
			await validateAsset(mod, vars);
		});

		// oxlint-disable-next-line vitest/expect-expect
		it('can encode a snapshot of variables', async () => {
			const vars = {
				VAR1: 'abc',
				VAR2: '123'
			};
			let mod = await createEnvVarsAssetModule(vars, {
				hash: 'abbbbbbbbc',
				updatedAt: 5000000001
			});
			await validateAsset(mod, vars, {
				hash: 'abbbbbbbbc',
				updatedAt: 5000000001
			});

			mod = await createEnvVarsAssetModule(vars, {
				hash: Buffer.from('abbbbbbbbc', 'hex'),
				updatedAt: '1970-02-27T20:53:20.001Z'
			});
			await validateAsset(mod, vars, {
				hash: 'abbbbbbbbc',
				updatedAt: 5000000001
			});
		});

		// oxlint-disable-next-line vitest/expect-expect
		it('can encode an empty set of variables', async () => {
			const mod = await createEnvVarsAssetModule({});
			await validateAsset(mod, {});
		});

		// oxlint-disable-next-line vitest/expect-expect
		it('can take a buffer with pre-encoded variables', async () => {
			const vars = {
				VAR1: 'abc',
				VAR2: '123'
			};
			const data = await encodeEnvVarsAsset(vars);
			const mod = await createEnvVarsAssetModule(data);
			await validateAsset(mod, vars);
		});

		describe('error handling', () => {
			it('invalid variable name', async () => {
				const msg = 'Invalid variable name: ';
				await expect(createEnvVarsAssetModule({ '': '123' })).rejects.toThrow(msg);
				await expect(createEnvVarsAssetModule({ abc: '123' })).rejects.toThrow(msg + 'abc');
				await expect(createEnvVarsAssetModule({ '1abc': '123' })).rejects.toThrow(msg + '1abc');
				await expect(createEnvVarsAssetModule({ abc$: '123' })).rejects.toThrow(msg + 'abc$');
			});

			it('variable name is too long', async () => {
				const msg = 'Variable name is too long: ';
				await expect(createEnvVarsAssetModule({ ['a'.repeat(129)]: '123' })).rejects.toThrow(msg + 'aaaaa');
			});

			it('variable value is not a string', async () => {
				const msg = 'Variable value is not a string: ';
				// @ts-expect-error a non-string value is rejected at runtime
				await expect(createEnvVarsAssetModule({ ABC: 123 })).rejects.toThrow(msg + 'ABC');
			});

			it('invalid snapshot hash', async () => {
				const msg = 'Invalid snapshot hash';
				await expect(createEnvVarsAssetModule({ ABC: '123' }, { hash: '', updatedAt: 1 })).rejects.toThrow(msg);
				await expect(
					createEnvVarsAssetModule({ ABC: '123' }, { hash: Buffer.from('not a hash', 'hex'), updatedAt: 1 })
				).rejects.toThrow(msg);
			});

			it('invalid snapshot timestamp', async () => {
				const msg = 'Invalid snapshot timestamp';
				await expect(createEnvVarsAssetModule({ ABC: '123' }, { hash: '11111111', updatedAt: -1 })).rejects.toThrow(
					msg
				);
				await expect(
					createEnvVarsAssetModule({ ABC: '123' }, { hash: '11111111', updatedAt: '2025-12-31T23:59:60.999Z' })
				).rejects.toThrow(msg);
			});

			it('asset exceeds the maximum size', async () => {
				const msg = 'Asset exceeds the maximum size';
				await expect(createEnvVarsAssetModule({ ABC: '1'.repeat(20000) })).rejects.toThrow(msg);
			});

			it('asset exceeds the maximum number of variables', async () => {
				const msg = 'Number of variables exceeds the maximum of 100';
				const vars: Record<string, string> = {};
				for (let i = 0; i < 101; i++) {
					vars['VAR' + i] = 'value';
				}
				await expect(createEnvVarsAssetModule(vars)).rejects.toThrow(msg);
			});
		});
	});
});
