/*
 *  Copyright 2015 Particle ( https://particle.io )
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/**
 * Created by middleca on 6/11/15.
 */

import * as fs from 'fs';

import * as ModuleInfo from './ModuleInfo';
import * as utilities from './utilities';

const { MIN_MODULE_SUFFIX_SIZE } = ModuleInfo;
const knownFunctionTypes = new Set<number>(Object.values(ModuleInfo.FunctionType));

/**
 * Understands how to parse out the header and footer metadata sections
 * of the 0.4.0 and later hal firmware for the
 * core/photon/electron / etc
 */
export class HalModuleParser {
	/**
	 * given a file / callback, goes and reads out all the info!
	 *
	 * meant to be multiply-re-entrant / thread safe
	 */
	async parseFile(filename: string, callback?: ParseCallback): Promise<FileInfo> {
		const fileBuffer = await this._loadFile(filename);
		return withCallback(this.parseBuffer({ filename, fileBuffer }), callback);
	}

	/**
	 * broken out if you're working with a buffer instead, expects a
	 * 'fileInfo' object with the
	 * 'fileBuffer' property set to your buffer.
	 *
	 * Adds the parsed fields to `fileInfo` and resolves to that same object.
	 */
	async parseBuffer(fileInfo: FileBufferInfo, callback?: ParseCallback): Promise<FileInfo> {
		if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}

		return withCallback(parseFileBuffer(this, fileInfo), callback);
	}

	/**
	 * Parse the module's prefix info.
	 *
	 * Adds `prefixInfo` to `fileInfo` and resolves to that same object.
	 */
	async parsePrefix<T extends FileBufferInfo>(fileInfo: T): Promise<T & { prefixInfo: PrefixInfo }> {
		if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}
		return Object.assign(fileInfo, { prefixInfo: this._readPrefix(fileInfo.fileBuffer) });
	}

	/**
	 * Parse the module's suffix info.
	 *
	 * Adds `suffixInfo` to `fileInfo` and resolves to that same object.
	 */
	async parseSuffix<T extends FileBufferInfo>(fileInfo: T): Promise<T & { suffixInfo: SuffixInfo }> {
		if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}
		return Object.assign(fileInfo, { suffixInfo: this._readSuffix(fileInfo.fileBuffer) });
	}

	/**
	 * goes and reads out the file if it exists and returns
	 * a promise with the fileBuffer
	 */
	async _loadFile(filename: string): Promise<Buffer> {
		if (!fs.existsSync(filename)) {
			throw new Error(filename + " doesn't exist");
		}

		const fileBuffer = fs.readFileSync(filename);
		if (!fileBuffer || fileBuffer.length === 0) {
			throw new Error(filename + ' was empty!');
		}

		return fileBuffer;
	}

	/**
	 * calculates the CRC of the buffer, and compares it to the
	 * stored CRC region of the file
	 *
	 * @returns `false` when the buffer is empty
	 */
	async _validateCRC(fileBuffer: Buffer): Promise<CrcInfo | false> {
		if (!fileBuffer || fileBuffer.length === 0) {
			return false;
		}
		return computeCrc(fileBuffer);
	}

	/**
	 * Validates whether the module binary has a valid
	 * module prefix at a certain offset.
	 *
	 * `score` goes from 0 to N, where 0 indicates invalid and N the highest level of confidence. `passed` is
	 * true if the module prefix completely passed all checks.
	 */
	_validateModulePrefix(fileBuffer: Buffer, offset = 0): { score: number; passed: boolean } {
		const result = { score: 0, passed: false };
		const prefix = fileBuffer.subarray(offset, offset + ModuleInfo.MODULE_PREFIX_SIZE);
		if (prefix.length < ModuleInfo.MODULE_PREFIX_SIZE) {
			return result;
		}

		// Parse module prefix
		const prefixInfo = this._parsePrefix(prefix, true /* test only */);
		// Start address should be < end address
		const startAddr = Number.parseInt(prefixInfo.moduleStartAddy, 16);
		const endAddr = Number.parseInt(prefixInfo.moduleEndAddy, 16);
		if (endAddr <= startAddr) {
			return result;
		}
		const expectedSize = endAddr - startAddr + 4; /* CRC-32 */
		if (fileBuffer.length < expectedSize) {
			return result;
		}
		// Module function should not be empty
		if (prefixInfo.moduleFunction === ModuleInfo.FunctionType.NONE) {
			return result;
		}
		// Empty dependencies should have index and version set to zero
		if (prefixInfo.depModuleFunction === ModuleInfo.FunctionType.NONE) {
			if (prefixInfo.depModuleIndex !== 0 || prefixInfo.depModuleVersion !== 0) {
				return result;
			}
		}
		// Empty dependencies should have index and version set to zero
		if (prefixInfo.dep2ModuleFunction === ModuleInfo.FunctionType.NONE) {
			if (prefixInfo.dep2ModuleIndex !== 0 || prefixInfo.dep2ModuleVersion !== 0) {
				return result;
			}
		}

		// If we got here, we have a seemingly valid module prefix
		result.score++;
		// XXX: make sure to update this if adding other sanity checks
		const maxScore = 7;
		// Increase score if platform ID is known
		if (Object.values(ModuleInfo.Platform).includes(prefixInfo.platformID)) {
			result.score++;
		}
		// Increase score if module function is one of the known module function types
		if (knownFunctionTypes.has(prefixInfo.moduleFunction)) {
			result.score++;
		}
		// Increase score if first dependency module function is one of the known module function types
		if (knownFunctionTypes.has(prefixInfo.depModuleFunction)) {
			result.score++;
		}
		// Increase score if second dependency module function is one of the known module function types
		if (knownFunctionTypes.has(prefixInfo.dep2ModuleFunction)) {
			result.score++;
		}
		// Module size according to the module prefix exactly matches
		// This is normally true for regular modules unless they are padded for certain reasons
		// or the passed buffer contains multiple modules (e.g. in case of combined modules)
		if (fileBuffer.length === expectedSize) {
			result.score++;
		}
		// Module flags are known
		const allFlags = Object.values(ModuleInfo.Flags).reduce((a: number, b) => a | b, 0);
		if ((prefixInfo.moduleFlags & ~allFlags) === 0) {
			result.score++;
		}
		result.passed = result.score >= maxScore;
		return result;
	}

	/**
	 * Finds the offset in the provided buffer where a valid module
	 * prefix is located.
	 *
	 * Depending on the module type, hardware platform requirements
	 * or other factors, module prefix may be present at a certain
	 * non-zero offset in the module binary.
	 */
	_findModulePrefixOffset(fileBuffer: Buffer): number {
		// This is simply an optimization to try a few preferred locations first
		// 0x184 is the size of Gen 2 MCU (STM32F2) interrupt vector table
		// 0x200 is the size of Gen 3 MCU (nRF52840) interrupt vector table
		// FIXME: Some of the deprecated platforms should be removed
		const preferredOffsets = [
			// Module prefix is normally found right at the beginning of the binary
			// at offset 0, unless there is a hardware requirement for something to be placed
			// there instead (e.g. interrupt vector table)
			0,
			0x200, // Gen 3
			0x184, // Gen 2
			0xc0, // Bluez
			0x10c // Core
		];

		let likelyOffset = 0;
		let likelyScore = 0;
		for (const offset of preferredOffsets) {
			const { score, passed } = this._validateModulePrefix(fileBuffer, offset);
			if (passed) {
				return offset;
			}
			if (score > likelyScore) {
				likelyOffset = offset;
				likelyScore = score;
			}
		}

		// Fallback to trying all (reasonable) offsets with 4 byte alignment
		const maxModulePrefixOffset = 8 * 1024; // Anything above 8KB is unreasonable
		const endAddress = Math.min(
			maxModulePrefixOffset,
			fileBuffer.length - ModuleInfo.MIN_MODULE_SUFFIX_SIZE - ModuleInfo.MODULE_PREFIX_SIZE - 4 /* CRC-32 */
		);
		for (let offset = 4; offset <= endAddress; offset += 4) {
			// Just an optimization
			if (preferredOffsets.includes(offset)) {
				continue;
			}
			const { score, passed } = this._validateModulePrefix(fileBuffer, offset);
			if (passed) {
				return offset;
			}
			if (score > likelyScore) {
				likelyOffset = offset;
				likelyScore = score;
			}
		}

		return likelyOffset;
	}

	/**
	 * parses out the prefix area of the binary, after attempting
	 * to determine the correct offset.
	 */
	_readPrefix(fileBuffer: Buffer): PrefixInfo {
		const prefixOffset = this._findModulePrefixOffset(fileBuffer);
		return { ...this._parsePrefix(fileBuffer.subarray(prefixOffset)), prefixOffset };
	}

	/**
	 * Parses a module prefix that starts at the beginning of `r`.
	 *
	 * @param test Stop at invalid extensions instead of throwing
	 */
	_parsePrefix(r: Buffer, test?: boolean): Omit<PrefixInfo, 'prefixOffset'> {
		//offset 0, 4-bytes: module start address
		let offs = 0;
		const moduleStartAddy = r.readUInt32LE(offs).toString(16);
		offs += 4;

		//offset 4, 4-bytes: module end address
		const moduleEndAddy = r.readUInt32LE(offs).toString(16);
		offs += 4;

		// reserved (MCU target on Gen 3)
		const reserved = r.readUInt8(offs);
		offs += 1;

		// offset 9, 1-byte: module flags (module_info_flags_t)
		const moduleFlags = r.readUInt8(offs);
		offs += 1;

		// offset 10, 2-bytes: module version (this is not the same as
		// product version, it relates to the module export functions)
		const moduleVersion = r.readUInt16LE(offs);
		offs += 2;

		// offset 12, 2-bytes: Platform ID (6 for Photon)
		const platformID = r.readUInt16LE(offs);
		offs += 2;

		// offset 14, 1-byte: module function (5 for user firmware)
		const moduleFunction = r.readUInt8(offs);
		offs += 1;

		// offset 15, 1-byte: module index (1 for user firmware)
		const moduleIndex = r.readUInt8(offs);
		offs += 1;

		// offset 16, 1-byte: dependency module function (usually system, 4)
		const depModuleFunction = r.readUInt8(offs);
		offs += 1;

		// offset 17, 1-byte: dependency module index (usually 2, so
		// dependency is system-part2)
		const depModuleIndex = r.readUInt8(offs);
		offs += 1;

		// offset 18, 1-byte: minimum version of system dependency
		const depModuleVersion = r.readUInt16LE(offs);
		offs += 2;

		// offset 20, 1-byte: dependency module function (usually system, 4)
		const dep2ModuleFunction = r.readUInt8(offs);
		offs += 1;

		// offset 21, 1-byte: dependency module index (usually 2, so
		// dependency is system-part2)
		const dep2ModuleIndex = r.readUInt8(offs);
		offs += 1;

		// offset 22, 2-byte: minimum version of system dependency
		const dep2ModuleVersion = r.readUInt16LE(offs);
		offs += 2;

		const prefix: Omit<PrefixInfo, 'prefixOffset'> = {
			moduleStartAddy: moduleStartAddy,
			moduleEndAddy: moduleEndAddy,
			reserved: reserved,
			moduleFlags: moduleFlags,
			moduleVersion: moduleVersion,
			platformID: platformID,
			moduleFunction: moduleFunction,
			moduleIndex: moduleIndex,
			depModuleFunction: depModuleFunction,
			depModuleIndex: depModuleIndex,
			depModuleVersion: depModuleVersion,
			dep2ModuleFunction: dep2ModuleFunction,
			dep2ModuleIndex: dep2ModuleIndex,
			dep2ModuleVersion: dep2ModuleVersion,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		if (moduleFlags & ModuleInfo.Flags.PREFIX_EXTENSIONS) {
			const extensions: ModuleExtension[] = [];

			while (offs < r.length - ModuleInfo.MIN_MODULE_SUFFIX_SIZE - 4) {
				const ext = this._readExtension(r, offs);
				if (!ext) {
					break;
				}
				extensions.push(ext);
				offs += ext.length;
				if (ext.length === 0) {
					if (test) {
						break;
					}
					throw new Error('Invalid extension length');
				}
				if (ext.type === ModuleInfo.ExtensionType.END) {
					break;
				}
			}
			if (extensions.length === 0 || extensions.at(-1)!.type !== ModuleInfo.ExtensionType.END) {
				if (!test) {
					throw new Error('Prefix extensions should end with END extension');
				}
			}
			prefix.extensions = extensions;
			prefix.prefixSize = offs;
		}

		return prefix;
	}

	/**
	 * Reads the module extension at `idx`.
	 *
	 * @returns `null` for an `INVALID` extension or one that runs past the end of the buffer
	 */
	_readExtension(fileBuffer: Buffer, idx: number): ModuleExtension | null {
		const type = fileBuffer.readUInt16LE(idx);
		idx += 2;
		const length = fileBuffer.readUInt16LE(idx);
		idx += 2;
		if (type === ModuleInfo.ExtensionType.INVALID) {
			return null;
		}
		if (idx + length - 4 > fileBuffer.length) {
			return null;
		}
		const offset = idx - 4;
		const extension: ModuleExtension = {
			type,
			length,
			offset,
			data: fileBuffer.subarray(offset, offset + length)
		};
		// For supported extensions we'll completely parse into a JS object
		switch (type) {
			case ModuleInfo.ExtensionType.PRODUCT_DATA: {
				// XXX: only reading out lower 16 bits
				idx += 2;
				extension.productId = fileBuffer.readUInt16LE(idx);
				idx += 2;
				extension.productVersion = fileBuffer.readUInt16LE(idx);
				break;
			}
			case ModuleInfo.ExtensionType.DYNAMIC_LOCATION: {
				extension.moduleStartAddress = fileBuffer.readUInt32LE(idx).toString(16);
				idx += 4;
				extension.dynalibLoadAddress = fileBuffer.readUInt32LE(idx).toString(16);
				idx += 4;
				extension.dynalibStartAddress = fileBuffer.readUInt32LE(idx).toString(16);
				break;
			}
			case ModuleInfo.ExtensionType.DEPENDENCY: {
				extension.moduleFunction = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.moduleIndex = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.moduleVersion = fileBuffer.readUInt16LE(idx);
				idx += 2;
				extension.targetId = fileBuffer.readUInt32LE(idx);
				break;
			}
			case ModuleInfo.ExtensionType.HASH: {
				extension.hashType = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hashLength = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hash = fileBuffer.subarray(idx, extension.offset + extension.length).toString('hex');
				break;
			}
			case ModuleInfo.ExtensionType.NAME: {
				extension.name = fileBuffer.subarray(idx, extension.offset + extension.length).toString();
				break;
			}
			case ModuleInfo.ExtensionType.ASSET_DEPENDENCY: {
				extension.hashType = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hashLength = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hash = fileBuffer.subarray(idx, idx + extension.hashLength).toString('hex');
				idx += extension.hashLength;
				extension.name = fileBuffer.subarray(idx, extension.offset + extension.length).toString();
				break;
			}
			case ModuleInfo.ExtensionType.SECURITY_MODE: {
				extension.securityMode = fileBuffer.readUInt8(idx);
				idx += 1;
				const certificate = fileBuffer.subarray(idx, extension.offset + extension.length);
				if (certificate && certificate.length > 0) {
					extension.certificate = certificate;
				}
				break;
			}
			case ModuleInfo.ExtensionType.ASSET_TYPE: {
				extension.assetType = fileBuffer.readUInt8(idx);
				break;
			}
		}
		return extension;
	}

	/**
	 * parses out the suffix area of the binary, only reads back
	 * into the file as far
	 * as is provided by the 'suffixSize' value.
	 */
	_readSuffix(fileBuffer: Buffer): SuffixInfo {
		// last 4 bytes of the file are the crc
		// 2 bytes before that is suffix payload size

		//lets read the suffix backwards.

		let idx = fileBuffer.length - 4;
		const crcBlock = fileBuffer.subarray(idx, idx + 4).toString('hex');

		idx -= 2;
		// This is the size of the module_info_suffix_t structure plus the size of the product ID and
		// product version fields
		const suffixSize = fileBuffer.readUInt16LE(idx);

		idx -= 32;
		const fwUniqueId = fileBuffer.subarray(idx, idx + 32).toString('hex');

		idx -= 2;
		const reserved = fileBuffer.readUInt16LE(idx);

		idx -= 2;
		let productVersion = fileBuffer.readUInt16LE(idx);

		idx -= 2;
		let productId = fileBuffer.readUInt16LE(idx);

		// Some considerations to take into account in order to preserve backward compatibility:
		//
		// 1. Some modules seem to have the suffix data filled with 0xff (see, e.g., RC4_bootloader_pad_BM-09.bin).
		//    In this case, this function reads and reports the product ID, product version and suffix size fields
		//    as 0xffff.
		//
		// 2. If the module suffix doesn't include the product ID and product version fields (i.e. the suffix size
		//    is less than 40 bytes), this function sets them to -1.
		//
		// 3. The module suffix may also include an extended 32-bit product ID. In this case, the value of the
		//    suffix size field must be valid.
		//
		// 4. A non-product firmware module has the product ID and version fields set to 0xffff (or 0xffffffff if
		//    an extended product ID is used). This is achieved by adding padding bytes to the module's prefix
		//    data at compile time.
		//
		// 5. When changing this method, make sure to update updateModuleSuffix() and MAX_MODULE_SUFFIX_SIZE
		//    accordingly.
		if (suffixSize < MIN_MODULE_SUFFIX_SIZE + 4) {
			productVersion = -1;
			productId = -1;
		}

		// Parse extensions
		const extensions: ModuleExtension[] = [];
		// NOTE: suffixSize is the size of the base module_info_suffix_t
		// (size, reserved, sha) + all the extensions above module_info_suffix_t.
		if (suffixSize > MIN_MODULE_SUFFIX_SIZE + 4) {
			idx = fileBuffer.length - 4 - suffixSize;

			while (idx > 0 && idx < fileBuffer.length - 4 - MIN_MODULE_SUFFIX_SIZE) {
				const ext = this._readExtension(fileBuffer, idx);
				if (!ext) {
					break;
				}
				extensions.push(ext);
				idx += ext.length;
				if (ext.length === 0) {
					throw new Error('Invalid extension length');
				}
				if (ext.type === ModuleInfo.ExtensionType.END) {
					break;
				}
			}
		}

		const suffix: SuffixInfo = {
			productId: productId,
			productVersion: productVersion,
			fwUniqueId: fwUniqueId,
			reserved: reserved,
			suffixSize: suffixSize,
			crcBlock: crcBlock
		};
		if (extensions.length) {
			suffix.extensions = extensions;
		}
		return suffix;
	}
}

/** Parses the module in `fileInfo.fileBuffer` and adds the parsed fields to `fileInfo` */
async function parseFileBuffer(parser: HalModuleParser, fileInfo: FileBufferInfo): Promise<FileInfo> {
	const parsed: ParsedFileFields = {
		crc: computeCrc(fileInfo.fileBuffer),
		prefixInfo: parser._readPrefix(fileInfo.fileBuffer),
		suffixInfo: parser._readSuffix(fileInfo.fileBuffer)
	};
	const extensions = [...(parsed.prefixInfo.extensions ?? []), ...(parsed.suffixInfo.extensions ?? [])];
	const assets = extensions
		.filter((ext) => ext.type === ModuleInfo.ExtensionType.ASSET_DEPENDENCY)
		.map((ext) => ({
			hashType: ext.hashType!,
			hash: ext.hash!,
			name: ext.name!
		}));
	if (assets.length > 0) {
		parsed.assets = assets;
	}
	const securityExtension = extensions.find((ext) => ext.type === ModuleInfo.ExtensionType.SECURITY_MODE);
	if (securityExtension) {
		parsed.security = { mode: securityExtension.securityMode! };
		if (securityExtension.certificate) {
			parsed.security.certificate = securityExtension.certificate;
		}
	}
	return Object.assign(fileInfo, parsed);
}

/** Calls the legacy `(result, error)` callback, if any, once `promise` settles */
async function withCallback<T>(promise: Promise<T>, callback?: (result: T | null, error: unknown) => void): Promise<T> {
	let result: T;
	try {
		result = await promise;
	} catch (error) {
		callback?.(null, error);
		throw error;
	}
	callback?.(result, null);
	return result;
}

function computeCrc(fileBuffer: Buffer): CrcInfo {
	const dataRegion = fileBuffer.subarray(0, fileBuffer.length - 4);
	const storedCrcValue = fileBuffer.subarray(fileBuffer.length - 4, fileBuffer.length);
	const crcResult = utilities.crc32(dataRegion);
	return {
		ok: Buffer.compare(storedCrcValue, crcResult) === 0,
		storedCrc: storedCrcValue.toString('hex'),
		actualCrc: crcResult.toString('hex')
	};
}

/**
 * A module extension read from a module's prefix or suffix. Fields other than `type`, `length`, `offset`
 * and `data` are only set for the extension types that carry them.
 */
export interface ModuleExtension {
	/** One of `ModuleInfo.ExtensionType` */
	type: number;
	/** Size in bytes, including the 4-byte type/length header */
	length: number;
	/** Offset of the extension in the parsed buffer */
	offset: number;
	/** Raw bytes of the extension, including the header */
	data: Buffer;
	/** `PRODUCT_DATA` (lower 16 bits only) */
	productId?: number;
	/** `PRODUCT_DATA` */
	productVersion?: number;
	/** `DYNAMIC_LOCATION`, hex-encoded */
	moduleStartAddress?: string;
	/** `DYNAMIC_LOCATION`, hex-encoded */
	dynalibLoadAddress?: string;
	/** `DYNAMIC_LOCATION`, hex-encoded */
	dynalibStartAddress?: string;
	/** `DEPENDENCY`, one of `ModuleInfo.FunctionType` */
	moduleFunction?: number;
	/** `DEPENDENCY` */
	moduleIndex?: number;
	/** `DEPENDENCY` */
	moduleVersion?: number;
	/** `DEPENDENCY` */
	targetId?: number;
	/** `HASH` and `ASSET_DEPENDENCY`, one of `ModuleInfo.ModuleInfoHashExtensionType` */
	hashType?: number;
	/** `HASH` and `ASSET_DEPENDENCY` */
	hashLength?: number;
	/** `HASH` and `ASSET_DEPENDENCY`, hex-encoded */
	hash?: string;
	/** `NAME` and `ASSET_DEPENDENCY` */
	name?: string;
	/** `SECURITY_MODE`, one of `ModuleInfo.ModuleInfoSecurityMode` */
	securityMode?: number;
	/** `SECURITY_MODE`, only when the module has one */
	certificate?: Buffer;
	/** `ASSET_TYPE`, one of `ModuleInfo.AssetType` */
	assetType?: number;
}

/** The module prefix (`module_info_t` in Device OS). */
export interface PrefixInfo {
	/** Hex-encoded start address */
	moduleStartAddy: string;
	/** Hex-encoded end address, which is also where the CRC-32 starts */
	moduleEndAddy: string;
	/** MCU target on Gen 3 */
	reserved: number;
	/** Bitmask of `ModuleInfo.Flags` */
	moduleFlags: number;
	moduleVersion: number;
	platformID: number;
	/** One of `ModuleInfo.FunctionType` */
	moduleFunction: number;
	moduleIndex: number;
	/** One of `ModuleInfo.FunctionType`, `NONE` when there is no dependency */
	depModuleFunction: number;
	depModuleIndex: number;
	depModuleVersion: number;
	/** One of `ModuleInfo.FunctionType`, `NONE` when there is no second dependency */
	dep2ModuleFunction: number;
	dep2ModuleIndex: number;
	dep2ModuleVersion: number;
	/** Size of the prefix in bytes, including extensions */
	prefixSize: number;
	/** Offset of the prefix in the module, non-zero when e.g. an interrupt vector table comes first */
	prefixOffset: number;
	/** Only when `moduleFlags` has `PREFIX_EXTENSIONS` */
	extensions?: ModuleExtension[];
}

/** The module suffix (`module_info_suffix_t` in Device OS). */
export interface SuffixInfo {
	/** `-1` when the suffix has no product data, `0xffff` for non-product firmware */
	productId: number;
	/** `-1` when the suffix has no product data, `0xffff` for non-product firmware */
	productVersion: number;
	/** Hex-encoded SHA-256 of the module */
	fwUniqueId: string;
	reserved: number;
	/** Size of the suffix in bytes, excluding the CRC-32 */
	suffixSize: number;
	/** Hex-encoded CRC-32 stored in the module */
	crcBlock: string;
	/** Only when the suffix has extensions */
	extensions?: ModuleExtension[];
}

export interface CrcInfo {
	/** Whether the stored CRC-32 matches the module data */
	ok: boolean;
	/** Hex-encoded */
	storedCrc: string;
	/** Hex-encoded */
	actualCrc: string;
}

/** An asset the module depends on, from its `ASSET_DEPENDENCY` extensions. */
export interface AssetInfo {
	/** One of `ModuleInfo.ModuleInfoHashExtensionType` */
	hashType: number;
	/** Hex-encoded */
	hash: string;
	name: string;
}

export interface SecurityInfo {
	/** One of `ModuleInfo.ModuleInfoSecurityMode` */
	mode: number;
	certificate?: Buffer;
}

/** The input to `parseBuffer()`, which adds the parsed fields to it. */
export interface FileBufferInfo {
	/** Module data */
	fileBuffer: Buffer;
	filename?: string;
}

/** The fields `parseBuffer()` and `parseFile()` add. */
export interface ParsedFileFields {
	crc: CrcInfo;
	prefixInfo: PrefixInfo;
	suffixInfo: SuffixInfo;
	/** Only when the module depends on assets */
	assets?: AssetInfo[];
	/** Only when the module has a security mode */
	security?: SecurityInfo;
}

export type FileInfo = FileBufferInfo & ParsedFileFields;

/**
 * @param fileInfo `null` on error
 * @param error `null` on success
 */
export type ParseCallback = (fileInfo: FileInfo | null, error: unknown) => void;
