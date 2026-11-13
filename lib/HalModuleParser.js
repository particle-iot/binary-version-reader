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

const fs = require('fs');
const utilities = require('./utilities.js');
const ModuleInfo = require('./ModuleInfo');

const MIN_MODULE_SUFFIX_SIZE = ModuleInfo.MIN_MODULE_SUFFIX_SIZE;


//Buffer is global

/**
 * A module extension read from a module's prefix or suffix. Fields other than `type`, `length`, `offset`
 * and `data` are only set for the extension types that carry them.
 *
 * @typedef {object} ModuleExtension
 * @property {number} type One of `ModuleInfo.ExtensionType`
 * @property {number} length Size in bytes, including the 4-byte type/length header
 * @property {number} offset Offset of the extension in the parsed buffer
 * @property {Buffer} data Raw bytes of the extension, including the header
 * @property {number} [productId] `PRODUCT_DATA` (lower 16 bits only)
 * @property {number} [productVersion] `PRODUCT_DATA`
 * @property {string} [moduleStartAddress] `DYNAMIC_LOCATION`, hex-encoded
 * @property {string} [dynalibLoadAddress] `DYNAMIC_LOCATION`, hex-encoded
 * @property {string} [dynalibStartAddress] `DYNAMIC_LOCATION`, hex-encoded
 * @property {number} [moduleFunction] `DEPENDENCY`, one of `ModuleInfo.FunctionType`
 * @property {number} [moduleIndex] `DEPENDENCY`
 * @property {number} [moduleVersion] `DEPENDENCY`
 * @property {number} [targetId] `DEPENDENCY`
 * @property {number} [hashType] `HASH` and `ASSET_DEPENDENCY`, one of `ModuleInfo.ModuleInfoHashExtensionType`
 * @property {number} [hashLength] `HASH` and `ASSET_DEPENDENCY`
 * @property {string} [hash] `HASH` and `ASSET_DEPENDENCY`, hex-encoded
 * @property {string} [name] `NAME` and `ASSET_DEPENDENCY`
 * @property {number} [securityMode] `SECURITY_MODE`, one of `ModuleInfo.ModuleInfoSecurityMode`
 * @property {Buffer} [certificate] `SECURITY_MODE`, only when the module has one
 * @property {number} [assetType] `ASSET_TYPE`, one of `ModuleInfo.AssetType`
 */

/**
 * The module prefix (`module_info_t` in Device OS).
 *
 * @typedef {object} PrefixInfo
 * @property {string} moduleStartAddy Hex-encoded start address
 * @property {string} moduleEndAddy Hex-encoded end address, which is also where the CRC-32 starts
 * @property {number} reserved MCU target on Gen 3
 * @property {number} moduleFlags Bitmask of `ModuleInfo.Flags`
 * @property {number} moduleVersion
 * @property {number} platformID
 * @property {number} moduleFunction One of `ModuleInfo.FunctionType`
 * @property {number} moduleIndex
 * @property {number} depModuleFunction One of `ModuleInfo.FunctionType`, `NONE` when there is no dependency
 * @property {number} depModuleIndex
 * @property {number} depModuleVersion
 * @property {number} dep2ModuleFunction One of `ModuleInfo.FunctionType`, `NONE` when there is no second dependency
 * @property {number} dep2ModuleIndex
 * @property {number} dep2ModuleVersion
 * @property {number} prefixSize Size of the prefix in bytes, including extensions
 * @property {number} prefixOffset Offset of the prefix in the module, non-zero when e.g. an interrupt vector table comes first
 * @property {ModuleExtension[]} [extensions] Only when `moduleFlags` has `PREFIX_EXTENSIONS`
 */

/**
 * The module suffix (`module_info_suffix_t` in Device OS).
 *
 * @typedef {object} SuffixInfo
 * @property {number} productId `-1` when the suffix has no product data, `0xffff` for non-product firmware
 * @property {number} productVersion `-1` when the suffix has no product data, `0xffff` for non-product firmware
 * @property {string} fwUniqueId Hex-encoded SHA-256 of the module
 * @property {number} reserved
 * @property {number} suffixSize Size of the suffix in bytes, excluding the CRC-32
 * @property {string} crcBlock Hex-encoded CRC-32 stored in the module
 * @property {ModuleExtension[]} [extensions] Only when the suffix has extensions
 */

/**
 * @typedef {object} CrcInfo
 * @property {boolean} ok Whether the stored CRC-32 matches the module data
 * @property {string} storedCrc Hex-encoded
 * @property {string} actualCrc Hex-encoded
 */

/**
 * An asset the module depends on, from its `ASSET_DEPENDENCY` extensions.
 *
 * @typedef {object} AssetInfo
 * @property {number} hashType One of `ModuleInfo.ModuleInfoHashExtensionType`
 * @property {string} hash Hex-encoded
 * @property {string} name
 */

/**
 * @typedef {object} SecurityInfo
 * @property {number} mode One of `ModuleInfo.ModuleInfoSecurityMode`
 * @property {Buffer} [certificate]
 */

/**
 * The input to `parseBuffer()`, which adds the parsed fields to it.
 *
 * @typedef {object} FileBufferInfo
 * @property {Buffer} fileBuffer Module data
 * @property {string} [filename]
 */

/**
 * The result of `parseBuffer()` and `parseFile()`.
 *
 * @typedef {object} ParsedFileFields
 * @property {CrcInfo} crc
 * @property {PrefixInfo} prefixInfo
 * @property {SuffixInfo} suffixInfo
 * @property {AssetInfo[]} [assets] Only when the module depends on assets
 * @property {SecurityInfo} [security] Only when the module has a security mode
 */

/**
 * @typedef {FileBufferInfo & ParsedFileFields} FileInfo
 */

/**
 * @callback ParseCallback
 * @param {FileInfo | null} fileInfo `null` on error
 * @param {unknown} error `null` on success
 * @returns {void}
 */

/**
 * Understands how to parse out the header and footer metadata sections
 * of the 0.4.0 and later hal firmware for the
 * core/photon/electron / etc
 */
class HalModuleParser {

	/**
	 * given a file / callback, goes and reads out all the info!
	 *
	 * meant to be multiply-re-entrant / thread safe
	 *
	 * @param {string} filename
	 * @param {ParseCallback} [callback]
	 * @returns {Promise<FileInfo>}
	 */
	async parseFile(filename, callback) {
		const fileBuffer = await this._loadFile(filename);
		const fileInfo = {
			filename: filename,
			fileBuffer: fileBuffer
		};

		try {
			const allDone = await this.parseBuffer(fileInfo);
			if (callback) {
				callback(allDone, null);
			}
			return allDone;

		} catch (error) {
			if (callback) {
				callback(null, error);
			}
			throw error;
		}
	}


	/**
	 * broken out if you're working with a buffer instead, expects a
	 * 'fileInfo' object with the
	 * 'fileBuffer' property set to your buffer.
	 *
	 * Adds the parsed fields to `fileInfo` and resolves to that same object.
	 *
	 * @param {FileBufferInfo} fileInfo
	 * @param {ParseCallback} [callback]
	 * @returns {Promise<FileInfo>}
	 */
	async parseBuffer(fileInfo, callback) {
		if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}

		try {
			fileInfo.crc = await this._validateCRC(fileInfo.fileBuffer);
			fileInfo.prefixInfo = await this._readPrefix(fileInfo.fileBuffer);
			fileInfo.suffixInfo = await this._readSuffix(fileInfo.fileBuffer);
			const assets = [].concat(fileInfo.prefixInfo.extensions || [])
				.concat(fileInfo.suffixInfo.extensions || [])
				.filter(ext => ext.type === ModuleInfo.ModuleInfoExtension.ASSET_DEPENDENCY)
				.map(ext => ({
					hashType: ext.hashType,
					hash: ext.hash,
					name: ext.name
				}));
			if (assets.length > 0) {
				fileInfo.assets = assets;
			}
			const security = [].concat(fileInfo.prefixInfo.extensions || [])
				.concat(fileInfo.suffixInfo.extensions || [])
				.filter(ext => ext.type === ModuleInfo.ModuleInfoExtension.SECURITY_MODE)
				.map(ext => ({
					mode: ext.securityMode,
					certificate: ext.certificate
				}));
			if (security.length) {
				fileInfo.security = security[0];
				if (!fileInfo.security.certificate) {
					delete fileInfo.security.certificate;
				}
			}
			if (callback) {
				callback(fileInfo, null);
			}
			return fileInfo;
		} catch (error) {
			if (callback) {
				callback(null, error);
			}
			throw error;
		}
	}

	/**
	 * Parse the module's prefix info.
	 *
	 * Adds `prefixInfo` to `fileInfo` and resolves to that same object.
	 *
	 * @param {FileBufferInfo} fileInfo
	 * @returns {Promise<FileBufferInfo & { prefixInfo: PrefixInfo }>}
	 */
	async parsePrefix(fileInfo) {
		if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}
		fileInfo.prefixInfo = await this._readPrefix(fileInfo.fileBuffer);
		return fileInfo;
	}

	/**
	 * Parse the module's suffix info.
	 *
	 * Adds `suffixInfo` to `fileInfo` and resolves to that same object.
	 *
	 * @param {FileBufferInfo} fileInfo
	 * @returns {Promise<FileBufferInfo & { suffixInfo: SuffixInfo }>}
	 */
	async parseSuffix(fileInfo) {
		if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}

		fileInfo.suffixInfo = await this._readSuffix(fileInfo.fileBuffer);
		return fileInfo;
	}

	/**
	 * goes and reads out the file if it exists and returns
	 * a promise with the fileBuffer
	 * @param {string} filename
	 * @returns {Promise<Buffer>}
	 */
	async _loadFile(filename) {
		if (!fs.existsSync(filename)) {
			throw new Error(filename + ' doesn\'t exist');
		}

		const fileBuffer = fs.readFileSync(filename);
		if (!fileBuffer || (fileBuffer.length === 0)) {
			throw new Error(filename + ' was empty!');
		}

		return fileBuffer;
	}

	/**
	 * calculates the CRC of the buffer, and compares it to the
	 * stored CRC region of the file
	 * @param {Buffer} fileBuffer
	 * @returns {Promise<CrcInfo | false>} `false` when the buffer is empty
	 */
	async _validateCRC(fileBuffer) {
		if (!fileBuffer || (fileBuffer.length === 0)) {
			//console.log('validateCRC: buffer was empty!');
			return false;
		}

		const dataRegion = fileBuffer.subarray(0, fileBuffer.length - 4);
		const storedCrcValue = fileBuffer.subarray(fileBuffer.length - 4, fileBuffer.length);

		const crcResult = utilities.crc32(dataRegion);
		const matching = Buffer.compare(storedCrcValue, crcResult);

		const result = {
			ok: (matching === 0),
			storedCrc: storedCrcValue.toString('hex'),
			actualCrc: crcResult.toString('hex')
		};

		//console.log('calculated crc was ' + result.actualCrc);

		return result;
	}

	/**
	 * Validates whether the module binary has a valid
	 * module prefix at a certain offset.
	 *
	 * `score` goes from 0 to N, where 0 indicates invalid and N the highest level of confidence. `passed` is
	 * true if the module prefix completely passed all checks.
	 *
	 * @param {Buffer} fileBuffer
	 * @param {number} [offset]
	 * @returns {{ score: number, passed: boolean }}
	 */
	_validateModulePrefix(fileBuffer, offset = 0) {
		const result = { score: 0, passed: false };
		const prefix = fileBuffer.subarray(offset, offset + ModuleInfo.MODULE_PREFIX_SIZE);
		if (prefix.length < ModuleInfo.MODULE_PREFIX_SIZE) {
			return result;
		}

		// Parse module prefix
		const prefixInfo = this._parsePrefix(prefix, true /* test only */);
		// Start address should be < end address
		let startAddr = prefixInfo.moduleStartAddy;
		if (typeof startAddr === 'string') {
			startAddr = Number.parseInt(startAddr, 16);
		}
		let endAddr = prefixInfo.moduleEndAddy;
		if (typeof endAddr === 'string') {
			endAddr = Number.parseInt(endAddr, 16);
		}
		if (endAddr <= startAddr) {
			return result;
		}
		const expectedSize = endAddr - startAddr + 4 /* CRC-32 */;
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
		if (Object.values(ModuleInfo.FunctionType).includes(prefixInfo.moduleFunction)) {
			result.score++;
		}
		// Increase score if first dependency module function is one of the known module function types
		if (Object.values(ModuleInfo.FunctionType).includes(prefixInfo.depModuleFunction)) {
			result.score++;
		}
		// Increase score if second dependency module function is one of the known module function types
		if (Object.values(ModuleInfo.FunctionType).includes(prefixInfo.dep2ModuleFunction)) {
			result.score++;
		}
		// Module size according to the module prefix exactly matches
		// This is normally true for regular modules unless they are padded for certain reasons
		// or the passed buffer contains multiple modules (e.g. in case of combined modules)
		if (fileBuffer.length === expectedSize) {
			result.score++;
		}
		// Module flags are known
		const allFlags = Object.values(ModuleInfo.Flags).reduce((a, b) => (a | b), 0);
		if ((prefixInfo.moduleFlags & (~allFlags)) === 0) {
			result.score++;
		}
		result.passed = (result.score >= maxScore);
		return result;
	}

	/**
	 * Finds the offset in the provided buffer where a valid module
	 * prefix is located.
	 *
	 * Depending on the module type, hardware platform requirements
	 * or other factors, module prefix may be present at a certain
	 * non-zero offset in the module binary.
	 *
	 * @param {Buffer} fileBuffer
	 * @returns {number}
	 */
	_findModulePrefixOffset(fileBuffer) {
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
			0xC0, // Bluez
			0x10C, // Core
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
		const endAddress = Math.min(maxModulePrefixOffset,
				fileBuffer.length - ModuleInfo.MIN_MODULE_SUFFIX_SIZE - ModuleInfo.MODULE_PREFIX_SIZE - 4 /* CRC-32 */);
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
	 * @param {Buffer} fileBuffer
	 * @returns {PrefixInfo}
	 */
	_readPrefix(fileBuffer) {
		const prefixOffset = this._findModulePrefixOffset(fileBuffer);

		const prefixInfo = this._parsePrefix(fileBuffer.subarray(prefixOffset));
		prefixInfo.prefixOffset = prefixOffset;
		return prefixInfo;
	}

	/**
	 * Parses a module prefix that starts at the beginning of `r`.
	 *
	 * @param {Buffer} r
	 * @param {boolean} [test] Stop at invalid extensions instead of throwing
	 * @returns {Omit<PrefixInfo, 'prefixOffset'>}
	 */
	_parsePrefix(r, test) {
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

		/** @type {Omit<PrefixInfo, 'prefixOffset'>} */
		const prefix = {
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
			const extensions = [];

			while (offs < (r.length - ModuleInfo.MIN_MODULE_SUFFIX_SIZE - 4)) {
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
				if (ext.type === ModuleInfo.ModuleInfoExtension.END) {
					break;
				}
			}
			if (extensions.length === 0 || extensions[extensions.length - 1].type !== ModuleInfo.ModuleInfoExtension.END) {
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
	 * @param {Buffer} fileBuffer
	 * @param {number} idx
	 * @returns {ModuleExtension | null} `null` for an `INVALID` extension or one that runs past the end of the buffer
	 */
	_readExtension(fileBuffer, idx) {
		const type = fileBuffer.readUInt16LE(idx);
		idx += 2;
		const length = fileBuffer.readUInt16LE(idx);
		idx += 2;
		if (type === ModuleInfo.ModuleInfoExtension.INVALID) {
			return null;
		}
		if ((idx + length - 4) > fileBuffer.length) {
			return null;
		}
		const offset = idx - 4;
		/** @type {ModuleExtension} */
		const extension = {
			type,
			length,
			offset,
			data: fileBuffer.subarray(offset, offset + length)
		};
		// For supported extensions we'll completely parse into a JS object
		switch (type) {
			case ModuleInfo.ModuleInfoExtension.PRODUCT_DATA: {
				// XXX: only reading out lower 16 bits
				idx += 2;
				extension.productId = fileBuffer.readUInt16LE(idx);
				idx += 2;
				extension.productVersion = fileBuffer.readUInt16LE(idx);
				break;
			}
			case ModuleInfo.ModuleInfoExtension.DYNAMIC_LOCATION: {
				extension.moduleStartAddress = fileBuffer.readUInt32LE(idx).toString(16);
				idx += 4;
				extension.dynalibLoadAddress = fileBuffer.readUInt32LE(idx).toString(16);
				idx += 4;
				extension.dynalibStartAddress = fileBuffer.readUInt32LE(idx).toString(16);
				break;
			}
			case ModuleInfo.ModuleInfoExtension.DEPENDENCY: {
				extension.moduleFunction = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.moduleIndex = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.moduleVersion = fileBuffer.readUInt16LE(idx);
				idx += 2;
				extension.targetId = fileBuffer.readUInt32LE(idx);
				break;
			}
			case ModuleInfo.ModuleInfoExtension.HASH: {
				extension.hashType = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hashLength = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hash = fileBuffer.subarray(idx, extension.offset + extension.length).toString('hex');
				break;
			}
			case ModuleInfo.ModuleInfoExtension.NAME: {
				extension.name = fileBuffer.subarray(idx, extension.offset + extension.length).toString();
				break;
			}
			case ModuleInfo.ModuleInfoExtension.ASSET_DEPENDENCY: {
				extension.hashType = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hashLength = fileBuffer.readUInt8(idx);
				idx += 1;
				extension.hash = fileBuffer.subarray(idx, idx + extension.hashLength).toString('hex');
				idx += extension.hashLength;
				extension.name = fileBuffer.subarray(idx, extension.offset + extension.length).toString();
				break;
			}
			case ModuleInfo.ModuleInfoExtension.SECURITY_MODE: {
				extension.securityMode = fileBuffer.readUInt8(idx);
				idx += 1;
				const certificate = fileBuffer.subarray(idx, extension.offset + extension.length);
				if (certificate && certificate.length > 0) {
					extension.certificate = certificate;
				}
				break;
			}
			case ModuleInfo.ModuleInfoExtension.ASSET_TYPE: {
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
	 *
	 * @param {Buffer} fileBuffer
	 * @returns {SuffixInfo}
	 */
	_readSuffix(fileBuffer) {
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

		if (reserved === 0) {
			//cool!
		}

		// Parse extensions
		const extensions = [];
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
				if (ext.type === ModuleInfo.ModuleInfoExtension.END) {
					break;
				}
			}
		}

		/** @type {SuffixInfo} */
		const suffix = {
			productId: productId,
			productVersion: productVersion,
			fwUniqueId: fwUniqueId,
			reserved: reserved,
			suffixSize: suffixSize,
			crcBlock: crcBlock,
		};
		if (extensions.length) {
			suffix.extensions = extensions;
		}
		return suffix;
	}
}
module.exports = HalModuleParser;
