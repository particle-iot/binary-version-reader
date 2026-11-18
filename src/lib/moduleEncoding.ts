import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import * as streamConsumers from 'stream/consumers';
import { promisify } from 'util';
import * as zlib from 'zlib';

import { platformsById, type FirmwareModuleInfo } from '@particle/device-constants';
import { schema as protobufSchema } from '@particle/device-os-protobuf';
import { ZipArchive } from 'archiver';
import * as unzip from 'unzipper';

import {
	HalModuleParser,
	type AssetInfo,
	type ModuleExtension,
	type PrefixInfo,
	type SuffixInfo
} from './HalModuleParser';
import * as ModuleInfo from './ModuleInfo';
import { crc32 } from './utilities';

const {
	Flags: ModuleFlags,
	MODULE_PREFIX_SIZE,
	MIN_MODULE_SUFFIX_SIZE,
	MAX_MODULE_SUFFIX_SIZE,
	ExtensionType
} = ModuleInfo;
const fsAsync = fs.promises;

const deflateRawAsync = promisify(zlib.deflateRaw);
const inflateRawAsync = promisify(zlib.inflateRaw);

/**
 * A module extension to encode. Has the same fields as a parsed `ModuleExtension`, which can be passed back as-is.
 */
export interface ModuleExtensionInput {
	/** One of `ModuleInfo.ExtensionType` */
	type: number;
	/** Raw extension bytes, written as-is instead of encoding the other fields */
	data?: Buffer;
	length?: number;
	/** `END` only: extra bytes after the extension header */
	padding?: number;
	/** `PRODUCT_DATA` */
	productId?: number;
	/** `PRODUCT_DATA` */
	productVersion?: number;
	/** `DYNAMIC_LOCATION`, a number or a hex-encoded string */
	moduleStartAddress?: string | number;
	/** `DYNAMIC_LOCATION`, a number or a hex-encoded string */
	dynalibLoadAddress?: string | number;
	/** `DYNAMIC_LOCATION`, a number or a hex-encoded string */
	dynalibStartAddress?: string | number;
	/** `DEPENDENCY` */
	moduleFunction?: number;
	/** `DEPENDENCY` */
	moduleIndex?: number;
	/** `DEPENDENCY` */
	moduleVersion?: number;
	/** `DEPENDENCY` */
	targetId?: number;
	/** `HASH` and `ASSET_DEPENDENCY`, defaults to SHA-256 */
	hashType?: number;
	/** `HASH` and `ASSET_DEPENDENCY`, a buffer or a hex-encoded string */
	hash?: string | Buffer;
	/** `NAME` and `ASSET_DEPENDENCY` */
	name?: string;
	/** `SECURITY_MODE` */
	securityMode?: number;
	/** `SECURITY_MODE` */
	certificate?: Buffer;
	/** `ASSET_TYPE` */
	assetType?: number;
}

/**
 * Prefix fields to write with `updateModulePrefix()`. Fields that are not set are left unchanged.
 */
export interface PrefixInput {
	/** Offset of the prefix in the module, defaults to 0 */
	prefixOffset?: number;
	/** A number or a hex-encoded string */
	moduleStartAddy?: string | number;
	/** A number or a hex-encoded string */
	moduleEndAddy?: string | number;
	reserved?: number;
	moduleFlags?: number;
	moduleVersion?: number;
	platformID?: number;
	moduleFunction?: number;
	moduleIndex?: number;
	depModuleFunction?: number;
	depModuleIndex?: number;
	depModuleVersion?: number;
	dep2ModuleFunction?: number;
	dep2ModuleIndex?: number;
	dep2ModuleVersion?: number;
	/** Required with `extensions`: the prefix size the module data was sized for */
	prefixSize?: number;
	/** Written only when `moduleFlags` has `PREFIX_EXTENSIONS` */
	extensions?: ModuleExtensionInput[];
}

/**
 * Suffix fields to write with `updateModuleSuffix()`. Fields other than `suffixSize` that are not set are left
 * unchanged.
 */
export interface SuffixInput {
	/** Must match the current suffix size */
	suffixSize?: number;
	productId?: number;
	productVersion?: number;
	reserved?: number;
	/** SHA-256, a buffer or a hex-encoded string */
	fwUniqueId?: string | Buffer;
	/** CRC-32, a buffer or a hex-encoded string */
	crcBlock?: string | Buffer;
	extensions?: ModuleExtensionInput[];
}

/** A named file, e.g. an application binary or an asset. */
export interface NamedData {
	name: string;
	data: Buffer;
}

/**
 * An asset to add as a dependency with `updateModuleAssetDependencies()`. Either `name` and `hash`, or `data`
 * (an asset module or raw asset data) with `name` when `data` is raw.
 */
export interface AssetDependencyInput {
	name?: string;
	/** SHA-256 of the asset, a buffer or a hex-encoded string */
	hash?: string | Buffer;
	data?: Buffer;
}

export interface ProcessedAsset {
	name: string;
	/** Size of the asset module in bytes */
	moduleSize: number;
	/** Space the asset takes in the device's asset storage, in bytes */
	storageSize: number;
	/** Size of the raw asset data in bytes */
	originalSize: number;
}

/** The asset sizes and platform limits checked by `validateAssetLimits()`, in bytes. */
export interface AssetLimitDetails {
	maxSingleAssetSize: number;
	maxTotalAssetSize: number;
	assets: ProcessedAsset[];
	totalAssetSize: number;
	/** Every limit that was exceeded */
	errors: AssetLimitError[];
}

/** The contents of a bundle made by `createApplicationAndAssetBundle()`. */
export interface UnpackedBundle {
	application?: NamedData;
	assets: NamedData[];
	/** The env vars JSON file, parsed */
	env?: { name: string; data: Record<string, string> };
}

export interface EnvVarsSnapshot {
	/** Snapshot hash. Can be a buffer or hex-encoded string. */
	hash: string | Buffer;
	/** Snapshot creation time. Can be a string in a format supported by `Date.parse()` or a numeric timestamp. */
	updatedAt: string | number;
}

export interface ChecksumOptions {
	/** Update CRC-32 of the resulting module (default: `true`). */
	updateCrc32?: boolean;
	/** Update SHA-256 of the resulting module (default: `true`). */
	updateSha256?: boolean;
}

export interface CompressOptions extends ChecksumOptions {
	/** Compression options (https://nodejs.org/api/zlib.html#zlib_class_options). */
	zlib?: zlib.ZlibOptions;
}

export interface AssetModuleOptions extends CompressOptions {
	/** Compress resulting module (default = true) */
	compress?: boolean;
	/** Asset type as defined by `ModuleInfo.AssetType` (default = `DEFAULT`) */
	type?: number;
}

type EditablePrefix = Omit<PrefixInfo, 'moduleStartAddy' | 'moduleEndAddy' | 'extensions'> & {
	moduleStartAddy: number;
	moduleEndAddy: number;
	extensions?: ModuleExtensionInput[];
};

type EditableSuffix = Omit<SuffixInfo, 'extensions'> & {
	extensions?: ModuleExtensionInput[];
};

const DEFAULT_START_ALIGNMENT = 8;

export const ENV_ASSET_NAME = 'env';
export const ENV_JSON_FILE = 'env.json';

export const MAX_ENV_SIZE: number = 16 * 1024;
const MAX_ENV_VARS = 100;

function moduleFunctionToString(func: number): string {
	switch (func) {
		case ModuleInfo.FunctionType.NONE: {
			return 'none';
		}
		case ModuleInfo.FunctionType.RESOURCE: {
			return 'resource';
		}
		case ModuleInfo.FunctionType.BOOTLOADER: {
			return 'bootloader';
		}
		case ModuleInfo.FunctionType.MONO_FIRMWARE: {
			return 'monoFirmware';
		}
		case ModuleInfo.FunctionType.SYSTEM_PART: {
			return 'systemPart';
		}
		case ModuleInfo.FunctionType.USER_PART: {
			return 'userPart';
		}
		case ModuleInfo.FunctionType.SETTINGS: {
			return 'settings';
		}
		case ModuleInfo.FunctionType.NCP_FIRMWARE: {
			return 'ncpFirmware';
		}
		case ModuleInfo.FunctionType.RADIO_STACK: {
			return 'radioStack';
		}
		case ModuleInfo.FunctionType.ASSET: {
			return 'asset';
		}
		default: {
			throw new RangeError('Unknown module function');
		}
	}
}

function firmwareModuleInfoForPlatformAndFunction(id: number, func: number, index?: number): FirmwareModuleInfo | null {
	const p = platformsById[id];
	if (!p) {
		throw new RangeError(`Unknown platform ID: ${id}`);
	}
	if (!p.firmwareModules) {
		return null;
	}
	const type = moduleFunctionToString(func);
	for (const m of p.firmwareModules) {
		if (m.type === type) {
			if (index === undefined || m.index === undefined || index === m.index) {
				return m;
			}
		}
	}
	return null;
}

/**
 * An error reported when assets are over the platform-specific limits
 */
export class AssetLimitError extends Error {
	details: Partial<AssetLimitDetails>;

	constructor(details: Partial<AssetLimitDetails>, message?: string, options?: ErrorOptions) {
		super(message, options);
		this.name = this.constructor.name;
		this.details = details;
	}
}

/**
 * An error reported when module data is over the platform-specific limits
 */
export class PlatformLimitError extends Error {
	details: object;

	constructor(details: object, message?: string, options?: ErrorOptions) {
		super(message, options);
		this.name = this.constructor.name;
		this.details = details;
	}
}

// Size of the `compressed_module_header` structure in Device OS
const COMPRESSED_MODULE_HEADER_SIZE = 8;

function sha256(data: Buffer): Buffer {
	return crypto.createHash('sha256').update(data).digest();
}

function shouldUpdateChecksum(value: boolean | undefined): boolean {
	return value === undefined || value;
}

/**
 * Compute and update the module's SHA-256 checksum.
 *
 * @param data Module data, updated in place.
 */
export function updateModuleSha256(data: Buffer): Buffer {
	const suffixSize = 38; // Size of the SHA-256, CRC-32 and suffix size fields
	if (data.length < suffixSize) {
		throw new RangeError('Invalid size of the module data');
	}
	const shaOffs = data.length - suffixSize;
	sha256(data.subarray(0, shaOffs)).copy(data, shaOffs);
	return data;
}

/**
 * Compute and update the module's CRC-32 checksum.
 *
 * @param data Module data, updated in place.
 */
export function updateModuleCrc32(data: Buffer): Buffer {
	if (data.length < 4) {
		throw new RangeError('Invalid size of the module data');
	}
	const crcOffs = data.length - 4;
	const crc = crc32(data.subarray(0, crcOffs));
	crc.copy(data, crcOffs);
	return data;
}

/**
 * Update the module's prefix data.
 *
 * Note: This function does not update the checksums of the module.
 *
 * @param data Module data, updated in place.
 * @returns `data`
 */
export function updateModulePrefix(data: Buffer, prefix: PrefixInput): Buffer {
	let offs = prefix.prefixOffset || 0;
	if (data.length < offs + MODULE_PREFIX_SIZE) {
		throw new RangeError('Invalid size of the module data');
	}
	// Start address
	if (prefix.moduleStartAddy !== undefined) {
		data.writeUInt32LE(sanitizeAddress(prefix.moduleStartAddy), offs);
	}
	offs += 4;
	// End address
	if (prefix.moduleEndAddy !== undefined) {
		data.writeUInt32LE(sanitizeAddress(prefix.moduleEndAddy), offs);
	}
	offs += 4;
	// Reserved field (MCU target on Gen 3)
	if (prefix.reserved !== undefined) {
		data.writeUInt8(prefix.reserved, offs);
	}
	offs += 1;
	// Module flags
	if (prefix.moduleFlags !== undefined) {
		data.writeUInt8(prefix.moduleFlags, offs);
	}
	offs += 1;
	// Module version
	if (prefix.moduleVersion !== undefined) {
		data.writeUInt16LE(prefix.moduleVersion, offs);
	}
	offs += 2;
	// Platform ID
	if (prefix.platformID !== undefined) {
		data.writeUInt16LE(prefix.platformID, offs);
	}
	offs += 2;
	// Module function
	if (prefix.moduleFunction !== undefined) {
		data.writeUInt8(prefix.moduleFunction, offs);
	}
	offs += 1;
	// Module index
	if (prefix.moduleIndex !== undefined) {
		data.writeUInt8(prefix.moduleIndex, offs);
	}
	offs += 1;
	// Module function (dependency 1)
	if (prefix.depModuleFunction !== undefined) {
		data.writeUInt8(prefix.depModuleFunction, offs);
	}
	offs += 1;
	// Module index (dependency 1)
	if (prefix.depModuleIndex !== undefined) {
		data.writeUInt8(prefix.depModuleIndex, offs);
	}
	offs += 1;
	// Module version (dependency 1)
	if (prefix.depModuleVersion !== undefined) {
		data.writeUInt16LE(prefix.depModuleVersion, offs);
	}
	offs += 2;
	// Module function (dependency 2)
	if (prefix.dep2ModuleFunction !== undefined) {
		data.writeUInt8(prefix.dep2ModuleFunction, offs);
	}
	offs += 1;
	// Module index (dependency 2)
	if (prefix.dep2ModuleIndex !== undefined) {
		data.writeUInt8(prefix.dep2ModuleIndex, offs);
	}
	offs += 1;
	// Module version (dependency 2)
	if (prefix.dep2ModuleVersion !== undefined) {
		data.writeUInt16LE(prefix.dep2ModuleVersion, offs);
	}
	offs += 2;
	if (prefix.moduleFlags !== undefined && prefix.moduleFlags & ModuleFlags.PREFIX_EXTENSIONS) {
		if (prefix.extensions) {
			// Validate size
			const expectedSize = calculateModulePrefixSize(prefix);
			if (expectedSize !== prefix.prefixSize) {
				// A sanity check to see whether the caller has resized the Buffer and already expects a certain
				// prefix size.
				throw new RangeError(
					`Extensions will not fit current prefix without resizing ${expectedSize} != ${prefix.prefixSize}`
				);
			}
			for (const ext of prefix.extensions) {
				const extData = ext.data ?? encodeModuleExtension(ext);
				extData.copy(data, offs);
				offs += extData.length;
			}
		}
	}
	return data;
}

/**
 * Calculate size of suffix data.
 */
function calculateModuleSuffixSize(suffix: SuffixInput): number {
	let size = MIN_MODULE_SUFFIX_SIZE;
	let seenProductExtension = false;
	for (const ext of suffix.extensions ?? []) {
		size += encodeModuleExtension(ext).length;
		if (ext.type === ExtensionType.PRODUCT_DATA) {
			seenProductExtension = true;
		}
	}
	if (!seenProductExtension) {
		// For compatibility purposes add raw product id/version data
		size += 4;
	}
	return size;
}

/**
 * Calculate size of prefix data.
 */
function calculateModulePrefixSize(prefix: PrefixInput): number {
	let size = MODULE_PREFIX_SIZE;
	if (prefix.moduleFlags !== undefined && prefix.moduleFlags & ModuleFlags.PREFIX_EXTENSIONS) {
		for (const ext of prefix.extensions ?? []) {
			size += encodeModuleExtension(ext).length;
		}
	}
	return size;
}

/**
 * Sanitize address type to Number.
 *
 * @param address Address either as a hex-encoded string or number
 */
export function sanitizeAddress(address: string | number): number {
	if (typeof address === 'string') {
		return Number.parseInt(address, 16);
	}
	return address;
}

function hashToBuffer(hash: string | Buffer): Buffer {
	return typeof hash === 'string' ? Buffer.from(hash, 'hex') : hash;
}

/**
 * Encode module extension.
 */
function encodeModuleExtension(extension: ModuleExtensionInput): Buffer {
	const EXTENSION_HEADER_SIZE = 4;
	let idx = 0;
	let buffer: Buffer;
	switch (extension.type) {
		case ExtensionType.PRODUCT_DATA: {
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 6);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt16LE(0xffff, idx);
			idx += 2;
			buffer.writeUInt16LE(extension.productId!, idx);
			idx += 2;
			buffer.writeUInt16LE(extension.productVersion!, idx);
			break;
		}
		case ExtensionType.DYNAMIC_LOCATION: {
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 12);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUint32LE(sanitizeAddress(extension.moduleStartAddress!), idx);
			idx += 4;
			buffer.writeUint32LE(sanitizeAddress(extension.dynalibLoadAddress!), idx);
			idx += 4;
			buffer.writeUint32LE(sanitizeAddress(extension.dynalibStartAddress!), idx);
			break;
		}
		case ExtensionType.DEPENDENCY: {
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 8);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt8(extension.moduleFunction!, idx);
			idx += 1;
			buffer.writeUInt8(extension.moduleIndex!, idx);
			idx += 1;
			buffer.writeUInt16LE(extension.moduleVersion!, idx);
			idx += 2;
			buffer.writeUInt32LE(extension.targetId!, idx);
			break;
		}
		case ExtensionType.HASH: {
			const hash = hashToBuffer(extension.hash!);
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 2 + hash.length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt8(extension.hashType ? extension.hashType : ModuleInfo.ModuleInfoHashExtensionType.SHA256, idx);
			idx += 1;
			buffer.writeUInt8(hash.length, idx);
			idx += 1;
			hash.copy(buffer, idx);
			break;
		}
		case ExtensionType.NAME: {
			const name = Buffer.from(extension.name!, 'utf8');
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + name.length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			name.copy(buffer, idx);
			break;
		}
		case ExtensionType.ASSET_DEPENDENCY: {
			const hash = hashToBuffer(extension.hash!);
			const name = Buffer.from(extension.name!, 'utf8');
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + name.length + hash.length + 2);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt8(extension.hashType ? extension.hashType : ModuleInfo.ModuleInfoHashExtensionType.SHA256, idx);
			idx += 1;
			buffer.writeUInt8(hash.length, idx);
			idx += 1;
			hash.copy(buffer, idx);
			idx += hash.length;
			name.copy(buffer, idx);
			break;
		}
		case ExtensionType.END: {
			let length = EXTENSION_HEADER_SIZE;
			if (extension.padding) {
				length += extension.padding;
			} else if (extension.data) {
				// Use same padding
				length = extension.data.length;
			}
			buffer = Buffer.alloc(length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			break;
		}
		case ExtensionType.SECURITY_MODE: {
			let length = EXTENSION_HEADER_SIZE + 1;
			if (extension.certificate) {
				length += extension.certificate.length;
			}
			buffer = Buffer.alloc(length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUint8(extension.securityMode!, idx);
			idx += 1;
			if (extension.certificate) {
				extension.certificate.copy(buffer, idx);
			}
			break;
		}
		case ExtensionType.ASSET_TYPE: {
			const assetType = extension.assetType;
			if (typeof assetType !== 'number' || assetType < 0 || assetType > 255) {
				throw new Error('Invalid asset type');
			}
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 2);
			idx = buffer.writeUInt16LE(extension.type, idx);
			idx = buffer.writeUint16LE(buffer.length, idx);
			idx = buffer.writeUInt8(assetType, idx);
			buffer.writeUInt8(0, idx); // Reserved
			break;
		}
		default: {
			if (extension.data && extension.data.length >= EXTENSION_HEADER_SIZE) {
				buffer = extension.data;
			} else {
				throw new RangeError('Unknown extension type');
			}
		}
	}
	return buffer;
}

/**
 * Update the module's suffix data.
 *
 * Note: This function can't be used to change the size of the suffix data and it does not update
 * the checksums of the module.
 *
 * @param data Module data, updated in place.
 * @returns `data`
 */
export function updateModuleSuffix(data: Buffer, suffix: SuffixInput): Buffer {
	const size = suffix.suffixSize;
	if (size === undefined || size < MIN_MODULE_SUFFIX_SIZE || size > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
	}
	if (data.length < size + 4 /* CRC-32 */) {
		throw new RangeError('Invalid size of the module data');
	}
	let offs = data.length - size - 4;
	let productOffs = offs;
	if (suffix.extensions) {
		const expectedSize = calculateModuleSuffixSize(suffix);
		if (expectedSize !== size) {
			// A sanity check to see whether the caller has resized the Buffer and already expects a certain
			// suffix size.
			throw new RangeError(`Extensions will not fit current suffix without resizing`);
		}
		let updatedProductOffs = false;
		for (const ext of suffix.extensions) {
			const extData = ext.data ?? encodeModuleExtension(ext);
			extData.copy(data, offs);
			offs += extData.length;
			// FIXME: This is not ideal, but by design product data extension
			// is at the same location as standalone product data on platforms
			// that don't have suffix extensions
			if (ext.type === ExtensionType.PRODUCT_DATA) {
				productOffs = offs - 4;
				updatedProductOffs = true;
			}
		}
		if (!updatedProductOffs) {
			productOffs = offs;
		}
	}
	offs = productOffs;
	if (size >= MIN_MODULE_SUFFIX_SIZE + 4) {
		// Product ID
		if (suffix.productId !== undefined) {
			// 16-bit product ID
			data.writeUInt16LE(suffix.productId, offs);
		}
		offs += 2;
		// Product version
		if (suffix.productVersion !== undefined) {
			data.writeUInt16LE(suffix.productVersion, offs);
		}
		offs += 2;
	}
	// Reserved field
	if (suffix.reserved !== undefined) {
		data.writeUInt16LE(suffix.reserved, offs);
	}
	offs += 2;
	// SHA-256 hash
	if (suffix.fwUniqueId !== undefined) {
		const hash = hashToBuffer(suffix.fwUniqueId);
		if (hash.length !== 32) {
			throw new RangeError('Invalid size of the SHA-256 checksum');
		}
		hash.copy(data, offs);
	}
	offs += 32;
	// Suffix size
	offs = data.writeUInt16LE(size, offs);
	// CRC-32 checksum
	if (suffix.crcBlock !== undefined) {
		const crc = hashToBuffer(suffix.crcBlock);
		if (crc.length !== 4) {
			throw new RangeError('Invalid size of the CRC-32 checksum');
		}
		crc.copy(data, offs);
	}
	return data;
}

/**
 * Compress the firmware module.
 */
export async function compressModule(data: Buffer, options?: CompressOptions): Promise<Buffer> {
	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: data });
	const startAddr = sanitizeAddress(prefix.moduleStartAddy);
	const endAddr = sanitizeAddress(prefix.moduleEndAddy);
	const flags = prefix.moduleFlags;
	if (flags & ModuleFlags.COMPRESSED) {
		throw new RangeError('Module is already compressed');
	}
	if (flags & ModuleFlags.COMBINED) {
		// Combined modules need to be compressed individually
		throw new RangeError("Can't compress a combined module");
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
	}
	let dataSize = endAddr - startAddr + 4; /* CRC-32 */
	const prefixOffs = prefix.prefixOffset || 0;
	if (data.length < prefixOffs + MODULE_PREFIX_SIZE + suffixSize + 4 || data.length !== dataSize) {
		throw new RangeError('Invalid size of the module data');
	}
	let dataOffs = 0;
	const prefixSize = prefix.prefixSize;
	if (prefixSize < MODULE_PREFIX_SIZE) {
		throw new RangeError('Invalid prefix data');
	}
	if (flags & ModuleFlags.DROP_MODULE_INFO) {
		if (prefixOffs !== 0) {
			throw new RangeError("DROP_MODULE_INFO can't be set for a module with a vector table");
		}
		// Skip the prefix data
		dataOffs = prefixSize;
		dataSize -= prefixSize;
		// No need to keep suffix around within the compressed section either
		dataSize -= suffixSize + 4; /* CRC-32 */
	}
	// Compress the module data
	const compData = await deflateRawAsync(data.subarray(dataOffs, dataOffs + dataSize), options?.zlib ?? {});
	const compDataSize = compData.length;
	// TODO: Consider using some linked buffers implementation to optimize memory usage,
	// e.g. https://www.npmjs.com/package/buffers
	const destBuf = Buffer.alloc(prefixSize + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize + 4);
	// Copy the prefix data
	let offs = 0;
	offs += data.copy(destBuf, offs, prefixOffs, prefixOffs + prefixSize);
	// Encode the header of the compressed data
	offs = destBuf.writeUInt16LE(COMPRESSED_MODULE_HEADER_SIZE, offs); // Header size
	offs = destBuf.writeUInt8(0, offs); // Compression method (raw Deflate)
	offs = destBuf.writeUInt8(options?.zlib?.windowBits || 0, offs); // Window size
	offs = destBuf.writeUInt32LE(dataSize, offs); // Size of the uncompressed data
	// Copy the compressed data
	offs += compData.copy(destBuf, offs);
	// Copy the suffix data
	const suffixOffs = data.length - suffixSize - 4;
	data.copy(destBuf, offs, suffixOffs, suffixOffs + suffixSize + 4);
	// Update the prefix data
	updateModulePrefix(destBuf, {
		moduleEndAddy: startAddr + prefixSize + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize, // CRC-32 is not included
		moduleFlags: flags | ModuleFlags.COMPRESSED
	});
	// Update the checksums
	if (shouldUpdateChecksum(options?.updateSha256)) {
		updateModuleSha256(destBuf);
	}
	if (shouldUpdateChecksum(options?.updateCrc32)) {
		updateModuleCrc32(destBuf);
	}
	return destBuf;
}

/**
 * Parses a module for adding, removing or listing its extensions, and finds whether its extensions belong in the
 * prefix or the suffix.
 */
async function parseExtensibleModule(module: Buffer) {
	const parser = new HalModuleParser();
	const { prefixInfo } = await parser.parsePrefix({ fileBuffer: module });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: module });
	const prefix: EditablePrefix = {
		...prefixInfo,
		moduleStartAddy: sanitizeAddress(prefixInfo.moduleStartAddy),
		moduleEndAddy: sanitizeAddress(prefixInfo.moduleEndAddy)
	};
	const flags = prefix.moduleFlags;
	if (flags & ModuleFlags.COMPRESSED) {
		throw new RangeError(`Can't add extensions to a compressed module`);
	}
	if (flags & ModuleFlags.COMBINED) {
		throw new RangeError(`Can't add extensions to a combined module`);
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
	}
	const dataSize = prefix.moduleEndAddy - prefix.moduleStartAddy + 4; /* CRC-32 */
	const prefixOffs = prefix.prefixOffset || 0;
	if (module.length < prefixOffs + MODULE_PREFIX_SIZE + suffixSize + 4 || module.length !== dataSize) {
		throw new RangeError('Invalid size of the module data');
	}

	const moduleInfo = firmwareModuleInfoForPlatformAndFunction(
		prefix.platformID,
		prefix.moduleFunction,
		prefix.moduleIndex
	);
	const extensionsInPrefix = !!(prefix.moduleFlags & ModuleFlags.PREFIX_EXTENSIONS || moduleInfo?.growsLeft);
	const extensions: ModuleExtension[] = (extensionsInPrefix ? prefixInfo.extensions : suffix.extensions) ?? [];

	return { prefix, suffix: suffix as EditableSuffix, prefixOffs, moduleInfo, extensionsInPrefix, extensions };
}

/**
 * Writes `extensions` to the prefix or the suffix of a module parsed with `parseExtensibleModule()`, resizing it as
 * needed, and updates the checksums.
 */
function writeModuleExtensions(
	module: Buffer,
	extensions: ModuleExtensionInput[],
	{ prefix, suffix, prefixOffs, moduleInfo, extensionsInPrefix }: Awaited<ReturnType<typeof parseExtensibleModule>>,
	clearEndExtensionData: boolean
): Buffer {
	if (extensionsInPrefix) {
		prefix.extensions = extensions;
	} else {
		suffix.extensions = extensions;
	}

	// Always add END extension: it is mandatory to be present in module prefix extensions
	// and due to the fact that product data for some of the platforms may not use an extension and just be
	// raw data, to indicate end we will also use END extension here.
	if (
		extensions.length > 0 &&
		extensions.at(-1)!.type !== ExtensionType.END &&
		extensions.at(-1)!.type !== ExtensionType.PRODUCT_DATA
	) {
		extensions.push({
			type: ExtensionType.END
		});
	}

	let buffer: Buffer | null = null;

	if (extensionsInPrefix && extensions.length > 0) {
		if (prefixOffs > 0) {
			throw new RangeError('Extensions in prefix are not supported for modules with non-zero prefix offset');
		}
		prefix.moduleFlags |= ModuleFlags.PREFIX_EXTENSIONS;
		prefix.extensions = extensions;
		const originalPrefixSize = prefix.prefixSize;
		const endExtension = extensions.at(-1)!;
		if (clearEndExtensionData) {
			delete endExtension.data;
			delete endExtension.length;
		}
		prefix.prefixSize = calculateModulePrefixSize(prefix);

		let newSize = module.length + (prefix.prefixSize - originalPrefixSize);
		const newStartAddr = prefix.moduleEndAddy - (newSize - 4);
		let alignment = 0;
		if (newStartAddr % DEFAULT_START_ALIGNMENT !== 0) {
			alignment = newStartAddr % DEFAULT_START_ALIGNMENT;
			newSize += alignment;
		}

		endExtension.padding = alignment;

		prefix.prefixSize += alignment;

		buffer = Buffer.alloc(newSize);
		module.copy(buffer, prefix.prefixSize, originalPrefixSize /* source offset */);
		prefix.moduleStartAddy = prefix.moduleEndAddy - (buffer.length - 4);

		for (const ext of suffix.extensions ?? []) {
			if (ext.type === ExtensionType.DYNAMIC_LOCATION) {
				// This has to be updated for certain platforms if start address is moved
				delete ext.data;
				ext.moduleStartAddress = prefix.moduleStartAddy;
			}
		}
	} else if (extensions.length > 0) {
		// In suffix
		suffix.extensions = extensions;
		const originalSuffixSize = suffix.suffixSize;
		suffix.suffixSize = calculateModuleSuffixSize(suffix);

		buffer = Buffer.alloc(module.length + (suffix.suffixSize - originalSuffixSize));
		module.copy(buffer, 0, 0, module.length - originalSuffixSize - 4 /* CRC-32 */);
		prefix.moduleEndAddy = prefix.moduleStartAddy + buffer.length - 4;
	}

	if (moduleInfo && moduleInfo.maxSize) {
		if (buffer!.length > moduleInfo.maxSize) {
			throw new PlatformLimitError({}, 'Resulting module exceeds platform size limits');
		}
	}

	updateModulePrefix(buffer!, prefix);
	updateModuleSuffix(buffer!, suffix);
	updateModuleSha256(buffer!);
	updateModuleCrc32(buffer!);

	return buffer!;
}

/**
 * Add new extensions to module prefix or suffix depending on the platform.
 *
 * @param options.module Module to update
 * @param options.exts List of extensions to add
 * @param options.replaceWithSameType Append extensions as-is or replace existing extensions of the same type
 * @returns The updated module
 */
export async function addModuleExtensions({
	module,
	exts = [],
	replaceWithSameType = false
}: {
	module: Buffer;
	exts?: ModuleExtensionInput[];
	replaceWithSameType?: boolean;
}): Promise<Buffer> {
	if (exts.length === 0) {
		throw new RangeError('Empty extension list');
	}

	const parsed = await parseExtensibleModule(module);
	let extensions: ModuleExtensionInput[] = parsed.extensions;

	if (replaceWithSameType) {
		extensions = extensions.filter((val) => !exts.some((ext) => val.type === ext.type));
	}

	if (parsed.extensionsInPrefix) {
		extensions = extensions.concat(exts);
	} else {
		extensions = exts.concat(extensions);
	}

	return writeModuleExtensions(module, extensions, parsed, false);
}

/**
 * Remove extensions of a particular type.
 *
 * @param options.module Module to update
 * @param options.exts Extension types to remove, from `ModuleInfo.ExtensionType`
 * @returns The updated module
 */
export async function removeModuleExtensions({
	module,
	exts = []
}: {
	module: Buffer;
	exts?: number[];
}): Promise<Buffer> {
	if (exts.length === 0) {
		throw new RangeError('Empty extension list');
	}

	const parsed = await parseExtensibleModule(module);
	const extensions = parsed.extensions.filter((val) => !exts.includes(val.type));
	return writeModuleExtensions(module, extensions, parsed, true);
}

/**
 * list extensions of a particular type.
 *
 * @param options.module Module to read
 * @param options.exts Extension types to list, from `ModuleInfo.ExtensionType`
 */
export async function listModuleExtensions({
	module,
	exts = []
}: {
	module: Buffer;
	exts?: number[];
}): Promise<ModuleExtension[]> {
	if (exts.length === 0) {
		throw new RangeError('Empty extension list');
	}

	const { extensions } = await parseExtensibleModule(module);
	return extensions.filter((val) => exts.includes(val.type));
}

/**
 * Update module info to include a set of asset dependencies
 *
 * @param data Module to update
 * @param assets List of assets to add as dependencies
 * @returns The updated module
 */
export async function updateModuleAssetDependencies(data: Buffer, assets: AssetDependencyInput[]): Promise<Buffer> {
	if (assets.length === 0) {
		throw new RangeError('Empty asset dependency list');
	}

	const exts = await Promise.all(
		assets.map(async (asset): Promise<ModuleExtensionInput> => {
			let name: string | undefined;
			let hash: string | Buffer | undefined;
			if (asset.name) {
				name = asset.name;
				hash = asset.hash;
			}
			if (!hash && asset.data) {
				let moduleInfo: { prefix: PrefixInfo; suffix: SuffixInfo } | undefined;
				const parser = new HalModuleParser();
				try {
					const fileInfo = await parser.parseBuffer({ fileBuffer: asset.data });

					if (fileInfo.crc && fileInfo.crc.ok) {
						// Looking like a valid module
						moduleInfo = {
							prefix: fileInfo.prefixInfo,
							suffix: fileInfo.suffixInfo
						};
					}
				} catch {
					// Ignore
				}
				let parsed = false;
				if (moduleInfo) {
					const extensions = [...(moduleInfo.prefix.extensions ?? []), ...(moduleInfo.suffix.extensions ?? [])];
					if (moduleInfo.prefix.moduleFunction === ModuleInfo.FunctionType.ASSET && extensions.length > 0) {
						for (const ext of extensions) {
							if (ext.type === ExtensionType.HASH) {
								hash = ext.hash;
							} else if (ext.type === ExtensionType.NAME) {
								name = ext.name;
							}
							if (name && hash) {
								parsed = true;
								break;
							}
						}
					}
				}
				if (!parsed) {
					// Raw asset data
					hash = sha256(asset.data);
				}
			}
			if (!name || !hash) {
				throw new RangeError('Invalid asset information');
			}
			return {
				type: ExtensionType.ASSET_DEPENDENCY,
				hashType: ModuleInfo.ModuleInfoHashExtensionType.SHA256,
				hash: hash,
				name: name
			};
		})
	);

	try {
		return await addModuleExtensions({ module: data, exts, replaceWithSameType: true });
	} catch (e) {
		if (e instanceof PlatformLimitError) {
			throw new AssetLimitError(e.details, e.message);
		}
		throw e;
	}
}

/**
 * Create asset module from raw asset data
 *
 * @param data Asset data.
 * @param name Asset name
 */
export async function createAssetModule(data: Buffer, name: string, options?: AssetModuleOptions): Promise<Buffer> {
	const extensions: ModuleExtensionInput[] = [
		{
			type: ExtensionType.HASH,
			hash: sha256(data),
			hashType: ModuleInfo.ModuleInfoHashExtensionType.SHA256
		},
		{
			type: ExtensionType.NAME,
			name: name
		}
	];
	if (options?.type !== undefined && options.type !== ModuleInfo.AssetType.DEFAULT) {
		extensions.push({
			type: ExtensionType.ASSET_TYPE,
			assetType: options.type
		});
	}
	extensions.push({
		// For compatibility
		type: ExtensionType.PRODUCT_DATA,
		productId: 0xffff,
		productVersion: 0xffff
	});

	const suffixInfo: SuffixInput = { extensions };
	suffixInfo.suffixSize = calculateModuleSuffixSize(suffixInfo);

	let buffer: Buffer = Buffer.alloc(MODULE_PREFIX_SIZE + suffixInfo.suffixSize + data.length + 4 /* CRC-32 */);
	// Generate module prefix and suffix
	const prefixInfo: PrefixInput = {
		moduleStartAddy: 0,
		moduleEndAddy: buffer.length - 4,
		moduleFunction: ModuleInfo.FunctionType.ASSET,
		moduleFlags: ModuleFlags.DROP_MODULE_INFO
	};

	data.copy(buffer, MODULE_PREFIX_SIZE);
	updateModulePrefix(buffer, prefixInfo);
	updateModuleSuffix(buffer, suffixInfo);
	updateModuleSha256(buffer);
	updateModuleCrc32(buffer);

	if (!options || options.compress === undefined || options.compress) {
		buffer = await compressModule(buffer, options);
	}

	return buffer;
}

/**
 * Unwrap asset module to raw asset data
 *
 * @param data Asset module
 */
export async function unwrapAssetModule(data: Buffer): Promise<Buffer> {
	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: data });
	if (prefix.moduleFunction !== ModuleInfo.FunctionType.ASSET) {
		throw new RangeError('Invalid module function type');
	}
	if (!(prefix.moduleFlags & ModuleFlags.DROP_MODULE_INFO)) {
		throw new RangeError('Asset modules should contain DROP_MODULE_INFO flag');
	}
	if (prefix.moduleFlags & ModuleFlags.COMPRESSED) {
		data = await decompressModule(data);
	}
	return data.subarray(prefix.prefixSize, data.length - 4 - suffix.suffixSize);
}

function isNamedData(value: Buffer | NamedData): value is NamedData {
	return !!((value as NamedData).data && (value as NamedData).name);
}

async function loadNamedData(file: Buffer | string | NamedData, defaultName: string): Promise<NamedData> {
	if (typeof file === 'string') {
		return {
			name: path.basename(file),
			data: await fsAsync.readFile(file)
		};
	}
	if (isNamedData(file)) {
		return file;
	}
	return {
		data: file,
		name: defaultName
	};
}

/**
 * Validate asset limits
 *
 * Rejects with an `AssetLimitError` for the first limit exceeded. The others are in its `details.errors`.
 *
 * @param application Application binary buffer/path
 * @param assets Asset data or paths
 */
export async function validateAssetLimits(
	application: Buffer | string | NamedData,
	assets?: (NamedData | string)[] | null
): Promise<AssetLimitDetails> {
	const app = await loadNamedData(application, 'application.bin');

	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: app.data });

	const p = platformsById[prefix.platformID];
	if (!p) {
		throw new RangeError(`Unknown platform ID: ${prefix.platformID}`);
	}

	if (!p.assets) {
		throw new RangeError('This platform does not support assets');
	}

	const storageLimit = p.assets.blockSize * (p.assets.storageTotalBlocks - p.assets.reservedBlocks);
	const errors: AssetLimitError[] = [];

	const { assets: limits } = p;
	const processedAssets: ProcessedAsset[] = await Promise.all(
		(assets ?? []).map(async (file) => {
			const asset = typeof file === 'string' ? await loadNamedData(file, file) : file;
			const assetModule = await createAssetModule(asset.data, asset.name);
			return {
				moduleSize: assetModule.length,
				storageSize:
					limits.assetOverhead +
					Math.ceil(assetModule.length / (limits.blockSize - limits.assetPerBlockOverhead)) * limits.blockSize,
				name: asset.name,
				originalSize: asset.data.length
			};
		})
	);
	const totalSize = processedAssets.reduce((total, asset) => total + asset.storageSize, 0);

	const details: AssetLimitDetails = {
		maxSingleAssetSize: p.assets.maxSingleAssetSize,
		maxTotalAssetSize: storageLimit,
		assets: processedAssets,
		totalAssetSize: totalSize,
		errors
	};

	for (const asset of processedAssets) {
		if (asset.moduleSize > p.assets.maxSingleAssetSize) {
			errors.push(
				new AssetLimitError(
					details,
					`Asset ${asset.name} exceeds maximum single asset size limit by ${asset.moduleSize - details.maxSingleAssetSize} bytes`
				)
			);
		}
	}

	if (totalSize > storageLimit) {
		errors.push(
			new AssetLimitError(details, `Total size of assets exceeds platform limits by ${totalSize - storageLimit} bytes`)
		);
	}

	if (errors.length > 0) {
		// Throw first one, additional can be accessed in err.details.errors
		throw errors[0];
	}

	return details;
}

/**
 * Create application and asset bundle
 *
 * @param application Application binary buffer/path
 * @param assets Asset data or paths. Gets the env vars asset appended when `vars` is set.
 * @param vars Env vars to include in the bundle as a JSON file and as an asset
 * @returns Zip file data
 */
export async function createApplicationAndAssetBundle(
	application: Buffer | string | NamedData,
	assets?: (NamedData | string)[] | null,
	vars?: Record<string, string>
): Promise<Buffer> {
	const app = await loadNamedData(application, 'application.bin');

	if (vars) {
		const varsAsset = await encodeEnvVarsAsset(vars);
		assets ||= [];
		assets.push({
			data: varsAsset,
			name: ENV_ASSET_NAME
		});
	}

	const processedAssets = await Promise.all(
		(assets ?? []).map(async (file) => (typeof file === 'string' ? loadNamedData(file, file) : file))
	);

	let updated: Buffer | undefined;
	if (processedAssets.length > 0) {
		const details = await validateAssetLimits(app, processedAssets);
		try {
			updated = await updateModuleAssetDependencies(app.data, processedAssets);
		} catch (err) {
			if (err instanceof AssetLimitError) {
				err.details = details;
				details.errors.push(err);
				throw err;
			}
		}
	} else {
		updated = app.data;
	}

	const archive = new ZipArchive({
		zlib: { level: 9 }
	});
	archive.append(updated!, { name: app.name });
	for (const asset of processedAssets) {
		archive.append(asset.data, { name: `assets/${asset.name}` });
	}
	if (vars) {
		archive.append(JSON.stringify(vars, null, 2), { name: ENV_JSON_FILE });
	}
	const [zip] = await Promise.all([streamConsumers.buffer(archive), archive.finalize()]);
	return zip;
}

export async function unpackApplicationAndAssetBundle(bundle: Buffer | string): Promise<UnpackedBundle> {
	const source = typeof bundle === 'string' ? fs.createReadStream(bundle) : Readable.from(bundle);
	const entries = source.pipe(unzip.Parse({ forceStream: true }));
	source.on('error', (error: Error) => entries.destroy(error));
	let current: unzip.Entry | undefined;
	let parseError: Error | undefined;
	entries.on('error', (error: Error) => {
		parseError = error;
		current?.destroy(error);
	});

	const result: UnpackedBundle = {
		assets: []
	};
	for await (const entry of entries as AsyncIterable<unzip.Entry>) {
		current = entry;
		if (parseError) {
			entry.destroy(parseError);
		}
		const dir = path.dirname(entry.path);
		if (entry.type !== 'File') {
			entry.autodrain();
		} else if (dir === 'assets') {
			result.assets.push({
				name: path.basename(entry.path),
				data: await streamConsumers.buffer(entry)
			});
		} else if (entry.path === ENV_JSON_FILE) {
			const data = await streamConsumers.buffer(entry);
			try {
				result.env = {
					name: entry.path,
					data: JSON.parse(data.toString('utf-8'))
				};
			} catch (err) {
				throw new Error(`Env file at ${entry.path} is invalid: ${(err as Error).message}`, { cause: err });
			}
		} else if (dir === '.' && path.extname(entry.path) === '.bin') {
			if (result.application) {
				throw new RangeError('More applications than expected in a bundle');
			}
			result.application = {
				name: entry.path,
				data: await streamConsumers.buffer(entry)
			};
		} else {
			entry.autodrain();
		}
	}
	return result;
}

/**
 * Decompress the firmware module.
 */
export async function decompressModule(data: Buffer): Promise<Buffer> {
	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: data });
	const startAddr = sanitizeAddress(prefix.moduleStartAddy);
	const endAddr = sanitizeAddress(prefix.moduleEndAddy);
	const flags = prefix.moduleFlags;
	if (!(flags & ModuleFlags.COMPRESSED)) {
		throw new RangeError('Module is not compressed');
	}
	if (flags & ModuleFlags.COMBINED) {
		// Combined modules need to be split and decompressed individually
		throw new RangeError("Can't decompress a combined module");
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
	}
	let dataSize = endAddr - startAddr + 4; /* CRC-32 */
	const prefixSize = prefix.prefixSize;
	if (prefixSize < MODULE_PREFIX_SIZE) {
		throw new RangeError('Invalid prefix size');
	}
	const minModuleSize = prefixSize + COMPRESSED_MODULE_HEADER_SIZE + suffixSize + 4;
	if (data.length < minModuleSize || data.length !== dataSize) {
		throw new RangeError('Invalid size of the module data');
	}
	// Parse the header of the compressed data
	let offs = prefixSize;
	const compHeaderSize = data.readUInt16LE(offs);
	if (compHeaderSize < COMPRESSED_MODULE_HEADER_SIZE) {
		throw new Error('Invalid size of the compressed data header');
	} else if (
		compHeaderSize > COMPRESSED_MODULE_HEADER_SIZE &&
		data.length < minModuleSize + compHeaderSize - COMPRESSED_MODULE_HEADER_SIZE
	) {
		throw new RangeError('Invalid size of the module data');
	}
	offs += 2;
	const compMethod = data.readUInt8(offs);
	if (compMethod !== 0) {
		// Raw Deflate
		throw new Error('Unknown compression method');
	}
	offs += 1;
	const windowBits = data.readUInt8(offs);
	if (windowBits !== 0 && !(windowBits >= 8 && windowBits <= 15)) {
		// Valid range for raw Deflate
		throw new Error('Invalid size of the decompression window');
	}
	offs += 1;
	const decompDataSize = data.readUInt32LE(offs);
	offs += 4;
	offs += compHeaderSize - COMPRESSED_MODULE_HEADER_SIZE; // Skip unknown fields if any
	// Decompress the module data
	dataSize -= prefixSize;
	const decompData = await inflateRawAsync(data.subarray(offs, offs + dataSize));
	if (decompData.length !== decompDataSize) {
		throw new Error('Unexpected size of the decompressed data');
	}
	let destBuf: Buffer = decompData;
	if (flags & ModuleFlags.DROP_MODULE_INFO) {
		// Restore the prefix and suffix data
		destBuf = Buffer.alloc(prefixSize + decompData.length + suffix.suffixSize + 4 /* CRC-32 */);
		data.copy(destBuf, 0, 0, prefixSize);
		decompData.copy(destBuf, prefixSize);
		updateModulePrefix(destBuf, {
			moduleEndAddy: startAddr + prefixSize + decompData.length + suffix.suffixSize, // CRC-32 is not part of the suffix
			moduleFlags: flags & ~ModuleFlags.COMPRESSED
		});
		updateModuleSuffix(destBuf, suffix);
		updateModuleSha256(destBuf);
		updateModuleCrc32(destBuf);
	}
	return destBuf;
}

/**
 * Combine firmware modules.
 */
export async function combineModules(modules: Buffer[], options?: ChecksumOptions): Promise<Buffer> {
	const parser = new HalModuleParser();
	const mods: { data: Buffer; flags: number; prefixOffs: number }[] = [];
	let totalSize = 0;
	const prefixes = await Promise.all(modules.map((data) => parser.parsePrefix({ fileBuffer: data })));
	for (const { fileBuffer: data, prefixInfo: prefix } of prefixes) {
		const startAddr = sanitizeAddress(prefix.moduleStartAddy);
		const endAddr = sanitizeAddress(prefix.moduleEndAddy);
		if (data.length !== endAddr - startAddr + 4 /* CRC-32 */) {
			throw new RangeError('Invalid size of the module data');
		}
		const flags = prefix.moduleFlags;
		if (flags & ModuleFlags.COMBINED) {
			throw new RangeError('Module is already combined');
		}
		mods.push({ data, flags, prefixOffs: prefix.prefixOffset });
		totalSize += data.length;
	}
	const [first] = mods;
	if (!first) {
		throw new RangeError('Modules array is empty');
	}
	if (mods.length === 1) {
		return first.data;
	}
	// TODO: Consider using some linked buffers implementation to optimize memory usage,
	// e.g. https://www.npmjs.com/package/buffers
	const destBuf = Buffer.alloc(totalSize);
	let offs = 0;
	for (const [i, mod] of mods.entries()) {
		mod.data.copy(destBuf, offs);
		// Set the COMBINED flag in each module's prefix data except for the last module
		if (i !== mods.length - 1) {
			const buf = destBuf.subarray(offs, offs + mod.data.length);
			updateModulePrefix(buf, {
				moduleFlags: mod.flags | ModuleFlags.COMBINED,
				prefixOffset: mod.prefixOffs
			});
			// Update the checksums
			if (shouldUpdateChecksum(options?.updateSha256)) {
				updateModuleSha256(buf);
			}
			if (shouldUpdateChecksum(options?.updateCrc32)) {
				updateModuleCrc32(buf);
			}
		}
		offs += mod.data.length;
	}
	return destBuf;
}

/**
 * Split combined firmware modules.
 */
export async function splitCombinedModules(data: Buffer, options?: ChecksumOptions): Promise<Buffer[]> {
	if (!data.length) {
		throw new RangeError('Invalid size of the module data');
	}
	const parser = new HalModuleParser();
	const mods: Buffer[] = [];
	let flags = 0;
	let offs = 0;
	do {
		if (data.length - offs < MODULE_PREFIX_SIZE + MIN_MODULE_SUFFIX_SIZE) {
			throw new RangeError('Invalid size of the module data');
		}
		const prefix = parser._readPrefix(data.subarray(offs));
		const startAddr = sanitizeAddress(prefix.moduleStartAddy);
		const endAddr = sanitizeAddress(prefix.moduleEndAddy);
		if (endAddr < startAddr) {
			throw new Error('Invalid module end address');
		}
		flags = prefix.moduleFlags;
		const size = endAddr - startAddr + 4; /* CRC-32 */
		if (data.length - offs < size) {
			throw new RangeError('Invalid size of the module data');
		}
		const destBuf = Buffer.alloc(size);
		mods.push(destBuf);
		offs += data.copy(destBuf, 0, offs, offs + size);
		if (flags & ModuleFlags.COMBINED) {
			// Clear the COMBINED flag
			updateModulePrefix(destBuf, {
				moduleFlags: flags & ~ModuleFlags.COMBINED,
				prefixOffset: prefix.prefixOffset
			});
			// Update the checksums
			if (shouldUpdateChecksum(options?.updateSha256)) {
				updateModuleSha256(destBuf);
			}
			if (shouldUpdateChecksum(options?.updateCrc32)) {
				updateModuleCrc32(destBuf);
			}
		} else {
			break;
		}
	} while (offs < data.length);
	if (flags & ModuleFlags.COMBINED || offs < data.length) {
		throw new Error('Invalid module data');
	}
	return mods;
}

/**
 * Check if the hash of the provided asset binary matches the asset info stored in the application binary
 *
 * @param asset the bytes of the asset
 * @param assetInfo the asset info block from the assets array returned by parseBuffer
 * @returns true if the asset matches the asset info. Throws for an unsupported hash type.
 */
export function isAssetValid(asset: Buffer, assetInfo: Pick<AssetInfo, 'hashType' | 'hash'>): boolean {
	if (assetInfo.hashType !== ModuleInfo.ModuleInfoHashExtensionType.SHA256) {
		throw new Error('Invalid asset hash type');
	}
	return sha256(asset).toString('hex') === assetInfo.hash;
}

/**
 * Add security mode extension to module with protected type.
 *
 * @returns The updated module
 */
export async function createProtectedModule(module: Buffer, certificate?: Buffer): Promise<Buffer> {
	const ext: ModuleExtensionInput = {
		type: ExtensionType.SECURITY_MODE,
		securityMode: ModuleInfo.ModuleInfoSecurityMode.PROTECTED
	};
	if (certificate) {
		ext.certificate = certificate;
	}
	return addModuleExtensions({ module, exts: [ext], replaceWithSameType: true });
}

/**
 * Encode the environment variables to a Device OS-compatible asset.
 *
 * @param vars Variable values.
 * @param snapshot Snapshot details. If not provided, the asset will be marked as containing application variables
 *        as opposed to a snapshot of cloud variables.
 * @param maxSize Maximum allowed size of the resulting module.
 * @param maxVars Maximum allowed number of variables in the resulting module.
 * @returns Asset data.
 */
export async function encodeEnvVarsAsset(
	vars: Record<string, string>,
	snapshot?: EnvVarsSnapshot,
	maxSize = MAX_ENV_SIZE,
	maxVars = MAX_ENV_VARS
): Promise<Buffer> {
	if (!vars || typeof vars !== 'object') {
		throw new Error('Expected variable values to be an object');
	}
	if (Object.keys(vars).length > maxVars) {
		throw new Error(`Number of variables exceeds the maximum of ${maxVars}`);
	}
	if (JSON.stringify(vars).length > maxSize) {
		throw new Error('Asset exceeds the maximum size');
	}
	for (const [name, val] of Object.entries(vars)) {
		if (name.length > 128) {
			throw new Error(`Variable name is too long: ${name.slice(0, 30)}...`);
		}
		if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
			throw new Error(`Invalid variable name: ${name}`);
		}
		if (typeof val !== 'string') {
			throw new Error(`Variable value is not a string: ${name}`);
		}
	}
	let hash: Buffer | undefined;
	let updatedAt: number | undefined;
	if (snapshot) {
		if (typeof snapshot !== 'object') {
			throw new Error('Expected snapshot details to be an object');
		}
		hash = Buffer.isBuffer(snapshot.hash) ? snapshot.hash : Buffer.from(snapshot.hash, 'hex');
		if (!hash.length) {
			throw new Error('Invalid snapshot hash');
		}
		updatedAt = typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.parse(snapshot.updatedAt);
		if (Number.isNaN(updatedAt) || updatedAt < 0) {
			throw new Error('Invalid snapshot timestamp');
		}
	}

	const EnvVars = protobufSchema.system.EnvVars;
	const assetData = EnvVars.encode(
		EnvVars.create({
			vars: Object.entries(vars).map(([name, value]) => EnvVars.Var.create({ name, value })),
			hash,
			updatedAt
		})
	).finish();
	return Buffer.from(assetData.buffer, assetData.byteOffset, assetData.byteLength);
}

/**
 * Create an asset module containing environment variables.
 *
 * @param vars Object with variable values or buffer with application variables encoded via `encodeEnvVarsAsset()`.
 * @param snapshot Snapshot details. If not provided, the asset will be marked as containing application variables
 *        as opposed to a snapshot of cloud variables.
 * @param maxSize Maximum allowed size of the resulting module.
 * @param maxVars Maximum allowed number of variables in the resulting module.
 * @returns Module binary.
 */
export async function createEnvVarsAssetModule(
	vars: Record<string, string> | Buffer,
	snapshot?: EnvVarsSnapshot,
	maxSize = MAX_ENV_SIZE,
	maxVars = MAX_ENV_VARS
): Promise<Buffer> {
	let assetData: Buffer;
	if (Buffer.isBuffer(vars)) {
		if (snapshot) {
			throw new Error('Cannot set snapshot details in already encoded asset data');
		}
		assetData = vars;
	} else {
		assetData = await encodeEnvVarsAsset(vars, snapshot, maxSize, maxVars);
	}

	return createAssetModule(assetData, ENV_ASSET_NAME, {
		type: snapshot ? ModuleInfo.AssetType.ENV_VARS_SNAPSHOT : ModuleInfo.AssetType.ENV_VARS_APP,
		compress: false
	});
}
