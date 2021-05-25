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

var fs = require('fs');
var when = require('when');
var pipeline = require('when/pipeline');
var utilities = require('./utilities.js');
var buffers = require('h5.buffers');
var ModuleInfo = require('./ModuleInfo');

var MIN_MODULE_SUFFIX_SIZE = ModuleInfo.MIN_MODULE_SUFFIX_SIZE;

//var BufferStream = require('./BufferStream.js');

//Buffer is global


/**
 * Understands how to parse out the header and footer metadata sections
 * of the 0.4.0 and later hal firmware for the
 * core/photon/electron / etc
 * @constructor
 */
var HalModuleParser = function() {

};
HalModuleParser.prototype = {

	/*
	 * given a file / callback, goes and reads out all the info!
	 *
	 * meant to be multiply-re-entrant / thread safe
	 *
	 * @param filename
	 * @param callback
	 * @returns {*}
	 */
	parseFile: function(filename, callback) {
		var fileInfo = {
			filename: filename
		};

		var that = this;
		var allDone = pipeline([
			function() {
				return that._loadFile(filename);
			},
			function(fileBuffer) {
				fileInfo.fileBuffer = fileBuffer;

				return that.parseBuffer(fileInfo);
			}
		]);

		if (callback) {
			when(allDone).then(
				function(info) {
					callback(info, null);
				},
				function(err) {
					callback(null, err);
				});
		}

		return allDone;
	},


	/*
	 * broken out if you're working with a buffer instead, expects a
	 * 'fileInfo' object with the
	 * 'fileBuffer' property set to your buffer.
	 * @param Object fileInfo
	 * @param Function callback
	 * @returns Promise
	 */
	parseBuffer: function(fileInfo, callback) {
		if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
			return when.reject('fileBuffer was invalid');
		}

		var that = this;
		var allDone = pipeline([
			function() {
				return that._validateCRC(fileInfo.fileBuffer);
			},
			function(crcInfo) {
				fileInfo.crc = crcInfo;

				return that._readPrefix(fileInfo.fileBuffer);
			},

			function(prefixInfo) {
				fileInfo.prefixInfo = prefixInfo;

				return that._readSuffix(fileInfo.fileBuffer);
			},
			function(suffixInfo) {
				fileInfo.suffixInfo = suffixInfo;

				return when.resolve();
			},

			function() {
				return fileInfo;
			}
		]);

		if (callback) {
			when(allDone).then(
				function(info) {
					callback(info, null);
				},
				function(err) {
					callback(null, err);
				});
		}

		return allDone;
	},

	/**
	 * Parse the module's prefix info.
	 *
	 * @param {Object} fileInfo File info.
	 * @param {Buffer} fileInfo.fileBuffer Module data.
	 * @returns {Promise<Object>}
	 */
	parsePrefix: function(fileInfo) {
		var that = this;
		return when.resolve()
			.then(function() {
				if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
					throw new Error('fileBuffer was invalid');
				}
				return that._readPrefix(fileInfo.fileBuffer);
			})
			.then(function(prefixInfo) {
				fileInfo.prefixInfo = prefixInfo;
				return fileInfo;
			});
	},

	/**
	 * Parse the module's suffix info.
	 *
	 * @param {Object} fileInfo File info.
	 * @param {Buffer} fileInfo.fileBuffer Module data.
	 * @returns {Promise<Object>}
	 */
	parseSuffix: function(fileInfo) {
		var that = this;
		return when.resolve()
			.then(function() {
				if (!Buffer.isBuffer(fileInfo.fileBuffer)) {
					throw new Error('fileBuffer was invalid');
				}
				return that._readSuffix(fileInfo.fileBuffer);
			})
			.then(function(suffixInfo) {
				fileInfo.suffixInfo = suffixInfo;
				return fileInfo;
			});
	},

	/*
	 * goes and reads out the file if it exists and returns
	 * a promise with the fileBuffer
	 * @param String filename
	 * @returns Promise
	 * @private
	 */
	_loadFile: function(filename) {
		if (!fs.existsSync(filename)) {
			return when.reject(filename + ' doesn\'t exist');
		}

		var fileBuffer = fs.readFileSync(filename);
		if (!fileBuffer || (fileBuffer.length === 0)) {
			return when.reject(filename + ' was empty!');
		}

		return when.resolve(fileBuffer);
	},

	/*
	 * calculates the CRC of the buffer, and compares it to the
	 * stored CRC region of the file
	 * @param Object fileBuffer
	 * @returns Boolean
	 * @private
	 */
	_validateCRC: function(fileBuffer) {
		if (!fileBuffer || (fileBuffer.length === 0)) {
			//console.log('validateCRC: buffer was empty!');
			return false;
		}

		var dataRegion = fileBuffer.slice(0, fileBuffer.length - 4);
		var storedCrcValue = fileBuffer.slice(fileBuffer.length - 4, fileBuffer.length);

		var crcResult = utilities.crc32(dataRegion);
		var matching = Buffer.compare(storedCrcValue, crcResult);

		var result = {
			ok: (matching === 0),
			storedCrc: storedCrcValue.toString('hex'),
			actualCrc: crcResult.toString('hex')
		};

		//console.log('calculated crc was ' + result.actualCrc);

		return when.resolve(result);
	},

	/*
	 * Validates whether the module binary has a valid
	 * module prefix at a certain offset.
	 *
	 * @param {Object} fileBuffer
	 * @param {number} offset
	 * @returns {Object} result
	 * @returns {number} result.score A score from 0 to N, where 0 indicates invalid and N the highest level of confidence
	 * @returns {boolean} result.passed Set to true if module prefix completely passed all checks
	 * @private
	 */
	_validateModulePrefix: function(fileBuffer, offset = 0, strict = false) {
		const result = { score: 0, passed: false };
		const prefix = fileBuffer.slice(offset, offset + ModuleInfo.MODULE_PREFIX_SIZE);
		if (prefix.length < ModuleInfo.MODULE_PREFIX_SIZE) {
			return result;
		}

		// Parse module prefix
		const prefixInfo = this._parsePrefix(prefix);
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
		// Allow one check to fail if not set to strict
		const maxScore = 7 - (strict ? 0 : 1);
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
		// Module size according to the module prefix exactly matches (should pass for non-padded binaries)
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
	},

	/*
	 * Finds the offset in the provided buffer where a valid module
	 * prefix is located.
	 *
	 * Depending on the module type, hardware platform requirements
	 * or other factors, module prefix may be present at a certain
	 * non-zero offset in the module binary.
	 *
	 * @param fileBuffer
	 * @returns {number}
	 * @private
	 */
	_findModulePrefixOffset: function(fileBuffer) {
		// This is simply an optimization to try a few preferred locations first
		// 0x184 is the size of Gen 2 MCU (STM32F2) interrupt vector table
		// 0x200 is the size of Gen 3 MCU (nRF52840) interrupt vector table
		// FIXME: Some of the deprecated platforms should be removed
		const preferredOffsets = [0,
			0x200, // Gen 3
			0x184, // Gen 2
			0xC0, // Bluez
			0x10C, // Core
		];

		let likelyOffset = 0;
		let likelyScore = 0;
		for (let offset of preferredOffsets) {
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
	},

	/*
	 * parses out the prefix area of the binary, after attempting
	 * to determine the correct offset. Returns:
	 * {
	 *	moduleStartAddy: string,
	 *	moduleEndAddy: string,
	 *	moduleFlags: number,
	 *	moduleVersion: number,
	 *	platformID: number,
	 *	moduleFunction: number,
	 *	moduleIndex: number,
	 *	depModuleFunction: number,
	 *	depModuleIndex: number,
	 *	depModuleVersion: number,
	 *	dep2ModuleFunction: number,
	 *	dep2ModuleIndex: number,
	 *	dep2ModuleVersion: number
	 * }
	 * @param fileBuffer
	 * @returns {{moduleStartAddy: string, moduleEndAddy: string, moduleFlags: number, moduleVersion: number, platformID: number, moduleFunction: number, moduleIndex: number, depModuleFunction: number, depModuleIndex: number, depModuleVersion: number}}
	 * @private
	 */
	_readPrefix: function(fileBuffer) {
		const prefixOffset = this._findModulePrefixOffset(fileBuffer);

		const prefixInfo = this._parsePrefix(fileBuffer.slice(prefixOffset));
		prefixInfo.prefixOffset = prefixOffset;
		return prefixInfo;
	},

	_parsePrefix: function(r) {
		//offset 0, 4-bytes: module start address
		let offs = 0;
		var moduleStartAddy = r.readUInt32LE(offs).toString(16);
		offs += 4;

		//offset 4, 4-bytes: module end address
		var moduleEndAddy = r.readUInt32LE(offs).toString(16);
		offs += 4;

		// reserved (MCU target on Gen 3)
		var reserved = r.readUInt8(offs);
		offs += 1;

		// offset 9, 1-byte: module flags (module_info_flags_t)
		var moduleFlags = r.readUInt8(offs);
		offs += 1;

		// offset 10, 2-bytes: module version (this is not the same as
		// product version, it relates to the module export functions)
		var moduleVersion = r.readUInt16LE(offs);
		offs += 2;

		// offset 12, 2-bytes: Platform ID (6 for Photon)
		var platformID = r.readUInt16LE(offs);
		offs += 2;

		// offset 14, 1-byte: module function (5 for user firmware)
		var moduleFunction = r.readUInt8(offs);
		offs += 1;

		// offset 15, 1-byte: module index (1 for user firmware)
		var moduleIndex = r.readUInt8(offs);
		offs += 1;

		// offset 16, 1-byte: dependency module function (usually system, 4)
		var depModuleFunction = r.readUInt8(offs);
		offs += 1;

		// offset 17, 1-byte: dependency module index (usually 2, so
		// dependency is system-part2)
		var depModuleIndex = r.readUInt8(offs);
		offs += 1;

		// offset 18, 1-byte: minimum version of system dependency
		var depModuleVersion = r.readUInt16LE(offs);
		offs += 2;

		// offset 20, 1-byte: dependency module function (usually system, 4)
		var dep2ModuleFunction = r.readUInt8(offs);
		offs += 1;

		// offset 21, 1-byte: dependency module index (usually 2, so
		// dependency is system-part2)
		var dep2ModuleIndex = r.readUInt8(offs);
		offs += 1;

		// offset 22, 2-byte: minimum version of system dependency
		var dep2ModuleVersion = r.readUInt16LE(offs);
		offs += 2;

		return {
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
			dep2ModuleVersion: dep2ModuleVersion
		};
	},

	/*
	 * parses out the suffix area of the binary, only reads back
	 * into the file as far
	 * as is provided by the 'suffixSize' value. Returns:
	 * {
	 *	productId: (*|Number),
	 *	productVersion: (*|Number),
	 *	fwUniqueId: (*|String),
	 *	reserved: (*|Number),
	 *	suffixSize: (*|Number),
	 *	crcBlock: (*|String)
	 * }
	 *
	 * @param fileBuffer
	 * @returns Object
	 * @private
	 */
	_readSuffix: function(fileBuffer) {
		// last 4 bytes of the file are the crc
		// 2 bytes before that is suffix payload size

		//lets read the suffix backwards.

		var idx = fileBuffer.length - 4;
		var crcBlock = fileBuffer.slice(idx, idx + 4).toString('hex');

		idx -= 2;
		// This is the size of the module_info_suffix_t structure plus the size of the product ID and
		// product version fields
		var suffixSize = fileBuffer.readUInt16LE(idx);

		idx -= 32;
		var fwUniqueId = fileBuffer.slice(idx, idx + 32).toString('hex');

		idx -= 2;
		var reserved = fileBuffer.readUInt16LE(idx);

		idx -= 2;
		var productVersion = fileBuffer.readUInt16LE(idx);

		idx -= 2;
		var productId = fileBuffer.readUInt16LE(idx);

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
		} else if (suffixSize === MIN_MODULE_SUFFIX_SIZE + 6) {
			idx -= 2;
			productId = fileBuffer.readUInt32LE(idx);
		}

		if (reserved === 0) {
			//cool!
		}

		return {
			productId: productId,
			productVersion: productVersion,
			fwUniqueId: fwUniqueId,
			reserved: reserved,
			suffixSize: suffixSize,
			crcBlock: crcBlock
		};
	},


	_: null
};
module.exports = HalModuleParser;
