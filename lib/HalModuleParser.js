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
var crc32 = require('buffer-crc32');
var utilities = require('./utilities.js');
var buffers = require('h5.buffers');

//var BufferStream = require('./BufferStream.js');

//Buffer is global


/**
 * Understands how to parse out the header and footer metadata sections
 * of the newer hal firmware for the
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

		var crcResult = crc32(dataRegion);
		var matching = utilities.bufferCompare(storedCrcValue, crcResult);
		//var matching = Buffer.compare(storedCrcValue, crcResult);

		var result = {
			//ok: (matching === 0),
			ok: matching,
			storedCrc: storedCrcValue.toString('hex'),
			actualCrc: crcResult.toString('hex')
		};

		//console.log('calculated crc was ' + result.actualCrc);

		return when.resolve(result);
	},

	/*
	 * tries to determine where we should be looking in the file.
	 *
	 * This changes based on whether or not we're in the bootloader,
	 * and we attempt to validate the result based on the assumption
	 * that firmware addresses tend to start with hex '80' since
	 * they're stored after
	 * 0x0800xxxx, etc.
	 *
	 * @param fileBuffer
	 * @returns {number}
	 * @private
	 */
	_divineModulePrefixOffset: function(fileBuffer) {
		// try no offset
		var r = new buffers.BufferReader(fileBuffer);
		var userModuleStartAddy = r.shiftUInt32(true).toString(16);

		// start over
		r = new buffers.BufferReader(fileBuffer);
		// skip 0x184 for system modules to skip the vector table
		r.skip(388);

		var sysModuleStartAddy = r.shiftUInt32(true).toString(16);

		// start over, test for Core monolithic firmware which has a different offset than modular firmware
		r = new buffers.BufferReader(fileBuffer);
		// skip 0x10C for Core firmware
		r.skip(0x10C);

		var coreModuleStartAddy = r.shiftUInt32(true).toString(16);

		// start over, test for bluz system part which has a different offset than Photon
		r = new buffers.BufferReader(fileBuffer);
		// skip 0xc0 for bluz system modules to skip the vector table
		r.skip(192);
		var bluzModuleStartAddy = r.shiftUInt32(true);
		// also check for the platform ID since the address is pretty nebulous to check for
		r = new buffers.BufferReader(fileBuffer);
		r.skip(192+12);
		var bluzModulesPlatformID = r.shiftUInt16(true);

		//just system modules have the offset at the beginning.
		// system module addresses always tend to start at 0x2xxxxxxx
		// while user modules tend to start around 0x8xxxxxxx

		// but any valid address right now should start with 80... something, since they're small / in the realm
		// of the bootloader....  we'll need some extra sanity checks somehow later if hardware changes dramatically.
		var mightBeUser = (userModuleStartAddy.indexOf("80") == 0);
		var mightBeSystem = (sysModuleStartAddy.indexOf("80") == 0);
		var isCore = ((userModuleStartAddy.indexOf("20") == 0) && (coreModuleStartAddy == "8005000"));
		var mightBeBluz = (bluzModulesPlatformID == 103 && bluzModuleStartAddy < 262144);

		if (isCore) {
			return 0x10C;
		}
		else if (!mightBeUser && mightBeSystem) {
			return 388;
		} else if (mightBeUser && !mightBeSystem) {
			return 0;
		} else if (mightBeBluz) {
			return 192;
		} else {
			return 0;
		}
	},

	/*
	 * parses out the prefix area of the binary, after attempting
	 * to determine the correct offset. Returns:
	 * {
	 *	moduleStartAddy: string,
	 *	moduleEndAddy: string,
	 *	moduleVersion: number,
	 *	platformID: number,
	 *	moduleFunction: number,
	 *	moduleIndex: number,
	 *	depModuleFunction: number,
	 *	depModuleIndex: number,
	 *	depModuleVersion: number
	 * }
	 * @param fileBuffer
	 * @returns {{moduleStartAddy: string, moduleEndAddy: string, moduleVersion: number, platformID: number, moduleFunction: number, moduleIndex: number, depModuleFunction: number, depModuleIndex: number, depModuleVersion: number}}
	 * @private
	 */
	_readPrefix: function(fileBuffer) {
		var isLittleEndian = true;
		var prefixOffset = this._divineModulePrefixOffset(fileBuffer);
		var r = new buffers.BufferReader(fileBuffer);

		// skip to system module offset, or stay at user module no offset
		r.skip(prefixOffset);

		//offset 0, 4-bytes: module start address
		var moduleStartAddy = r.shiftUInt32(isLittleEndian).toString(16);

		//offset 4, 4-bytes: module end address
		var moduleEndAddy = r.shiftUInt32(isLittleEndian).toString(16);

		r.skip(2);

		// offset 10, 2-bytes: module version (this is not the same as
		// product version, it relates to the module export functions)
		var moduleVersion = r.shiftUInt16(isLittleEndian);

		// offset 12, 2-bytes: Platform ID (6 for Photon)
		var platformID = r.shiftUInt16(isLittleEndian);

		// offset 14, 1-byte: module function (5 for user firmware)
		var moduleFunction = r.shiftUInt8();

		// offset 15, 1-byte: module index (1 for user firmware)
		var moduleIndex = r.shiftUInt8();

		// offset 16, 1-byte: dependency module function (usually system, 4)
		var depModuleFunction = r.shiftUInt8(isLittleEndian);

		// offset 17, 1-byte: dependency module index (usually 2, so
		// dependency is system-part2)
		var depModuleIndex = r.shiftUInt8(isLittleEndian);

		// offset 18, 1-byte: minimum version of system dependency
		var depModuleVersion = r.shiftUInt8(isLittleEndian);

		return {
			moduleStartAddy: moduleStartAddy,
			moduleEndAddy: moduleEndAddy,
			moduleVersion: moduleVersion,
			platformID: platformID,
			moduleFunction: moduleFunction,
			moduleIndex: moduleIndex,
			depModuleFunction: depModuleFunction,
			depModuleIndex: depModuleIndex,
			depModuleVersion: depModuleVersion
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
		var suffixSize = fileBuffer.readUInt16LE(idx);

		idx -= 32;
		var fwUniqueId = fileBuffer.slice(idx, idx + 32).toString('hex');

		idx -= 2;
		var reserved = fileBuffer.readUInt16LE(idx);

		idx -= 2;
		var productVersion = fileBuffer.readUInt16LE(idx);

		idx -= 2;
		var productId = fileBuffer.readUInt16LE(idx);


		if (reserved === 0) {
			//cool!
		}

		if (suffixSize < 40) {
			productId = -1;
			productVersion = -1;
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
