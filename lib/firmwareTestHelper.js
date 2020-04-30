'use strict';

const { FunctionType, MODULE_PREFIX_SIZE } = require('./ModuleInfo');
const { crc32 } = require('./utilities.js');

module.exports = {
	// Creates a valid firmware binary for usage in tests
	createFirmwareBinary({
			buffer = Buffer.from('dummy'),
			addVectorTable = false,
			vectorTableSize = 388,
			moduleStartAddress = 0x08000000,
			productId,
			productVersion,
			platformId,
			moduleFunction = FunctionType.USER_PART,
			moduleIndex = 1,
			depModuleFunction = FunctionType.SYSTEM_PART,
			depModuleIndex = 1,
			depModuleVersion = 1000	} = {}) {
		const suffixLength = 40;
		if (typeof productId === 'undefined') {
			productId = 0xFFFF;
		}
		if (typeof productVersion === 'undefined') {
			productVersion = 0xFFFF;
		}
		if (buffer.length < 512) {
			// HalModuleParser fails if the module is too small
			buffer = Buffer.concat([buffer, Buffer.alloc(512 - buffer.length, 0)]);
		}
		const vectorTable = Buffer.alloc(addVectorTable ? vectorTableSize : 0, 0);

		// Offsets correspond to HalModuleParser.js#L299
		const prefix = Buffer.alloc(MODULE_PREFIX_SIZE, 0);
		prefix.writeUInt32LE(moduleStartAddress, 0);
		prefix.writeUInt32LE(moduleStartAddress + vectorTable.length + prefix.length + buffer.length + suffixLength, 4);
		prefix.writeUInt16LE(platformId, 12);
		prefix.writeUInt8(moduleFunction, 14);
		prefix.writeUInt8(moduleIndex, 15);
		prefix.writeUInt8(depModuleFunction, 16);
		prefix.writeUInt8(depModuleIndex, 17);
		prefix.writeUInt16LE(depModuleVersion, 18);
		const fwBuffer = Buffer.concat([vectorTable, prefix, buffer, Buffer.alloc(suffixLength, 0)]);
		fwBuffer.writeUInt16LE(productId, fwBuffer.length - suffixLength);
		fwBuffer.writeUInt16LE(productVersion, fwBuffer.length - suffixLength + 2);
		fwBuffer.writeUInt16LE(0, fwBuffer.length - suffixLength + 4);
		fwBuffer.writeUInt16LE(suffixLength, fwBuffer.length - 2);

		const crc = crc32(fwBuffer);
		return Buffer.concat([fwBuffer, crc]);
	}
};
