/**
 * Created by middleca on 6/11/15.
 */

var fs = require('fs');
var when = require('when');
var extend = require('xtend');
var pipeline = require('when/pipeline');
var crc32 = require('buffer-crc32');
var utilities = require('./utilities.js');
var buffers = require('h5.buffers');

//var BufferStream = require('./BufferStream.js');

//Buffer is global


var HalModuleParser = function() {

};
HalModuleParser.prototype = {

	parseFile: function(filename) {
		var fileInfo = {
			filename: filename
		};

		var that = this;
		return pipeline([
			function() {
				return that._loadFile(filename);
			},
			function(fileBuffer) {
				fileInfo.fileBuffer = fileBuffer;

				return that._validateCRC(fileInfo.fileBuffer);
			},
			function(crcInfo) {
				fileInfo.crc = crcInfo;

				return that._readPrefix(fileInfo.fileBuffer);
			},

			function(prefixInfo) {
				fileInfo.prefixInfo = prefixInfo;
				//fileInfo = extend(fileInfo, prefixInfo);

				return that._readSuffix(fileInfo.fileBuffer);
			},
			function(suffixInfo) {
				fileInfo = extend(fileInfo, suffixInfo);


				return when.resolve();
			},

			function() {
				return fileInfo;
			}
		]);
	},


	_loadFile: function(filename) {
		if (!fs.existsSync(filename)) {
			return when.reject(filename + " doesn't exist");
		}

		var fileBuffer = fs.readFileSync(filename);
		if (!fileBuffer || (fileBuffer.length == 0)) {
			return when.reject(filename + " was empty!");
		}

		return when.resolve(fileBuffer);
	},


	_validateCRC: function(fileBuffer) {
		if (!fileBuffer || (fileBuffer.length == 0)) {
			//console.log("validateCRC: buffer was empty!");
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

		return when.resolve(result);
	},

	_readPrefix: function(fileBuffer) {
		var isLittleEndian = true;
		var r = new buffers.BufferReader(fileBuffer);

		// skip 0x184 for system modules to skip the vector table
		r.skip(388);

		//offset 0, 4-bytes: module start address
		var moduleStartAddy = r.shiftUInt32(isLittleEndian);

		//offset 4, 4-bytes: module end address
		var moduleEndAddy = r.shiftUInt32(isLittleEndian);

		r.skip(2);

		//offset 10, 2-bytes: module version (this is not the same as product version, it relates to the module export functions)
		var moduleVersion = r.shiftUInt16(isLittleEndian);

		//offset 12, 2-bytes: Platform ID (6 for Photon)
		var platformID = r.shiftUInt16(isLittleEndian);

		//offset 14, 1-byte: module function (5 for user firmware)
		var moduleFunction = r.shiftUInt8();

		//offset 15, 1-byte: module index (1 for user firmware)
		var moduleIndex = r.shiftUInt8();

		//offset 16, 1-byte: dependency module function (usually system, 4)
		var depModuleFunction = r.shiftUInt8(isLittleEndian);

		//offset 17, 1-byte: dependency module index (usually 2, so dependency is system-part2)
		var depModuleIndex = r.shiftUInt8(isLittleEndian);

		//offset 18, 1-byte: minimum version of system dependency
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

	_readSuffix: function(fileBuffer) {
//function two_bytes_at(file, offset) {
//   return file[offset] + (file[offset+1]*256)
//}
//
//firmware = ...   // the firmware file
//file_length = length(firmware)
//info_block_size = two_bytes_at(firmware, file_length-4)
//
//if (info_block_size>=40) {
//  product_info_offset =  file_length-4-info_block_size
//  product_id = two_bytes_at(firmware, product_info_offset)
//  product_version = two_bytes_at(firmware, product_info_offset+2)
//}




	},


	_: null
};
module.exports = HalModuleParser;