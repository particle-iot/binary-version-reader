/**
 * Created by middleca on 6/11/15.
 */

var fs = require('fs');
var when = require('when');
var extend = require('xtend');
var pipeline = require('when/pipeline');
var crc32 = require('buffer-crc32');
var utilities = require('./utilities.js');
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



	_: null
};
module.exports = HalModuleParser;