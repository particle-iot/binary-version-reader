'use strict';

const crc32 = require('buffer-crc32');
const { FunctionType } = require('./ModuleInfo');

module.exports = {
	// Creates a valid firmware binary for usage in tests
	createFirmwareBinary({ buffer = Buffer.from('dummy'), productId, productVersion, platformId, moduleFunction = FunctionType.USER_PART, moduleIndex = 1, depModuleFunction = FunctionType.SYSTEM_PART, depModuleIndex = 1, depModuleVersion = 1000 } = {}) {
		const length = 40;
		if (typeof productId === 'undefined') {
			productId = 0xFFFF;
		}
		if (typeof productVersion === 'undefined') {
			productVersion = 0xFFFF;
		}

		// Offsets correspond to HalModuleParser.js#L299
		const prefix = Buffer.alloc(0x19, 0);
		prefix.write('80000000', 0, 4, 'hex');
		prefix.writeUInt16LE(platformId, 12);
		prefix.writeUInt8(moduleFunction, 14);
		prefix.writeUInt8(moduleIndex, 15);
		prefix.writeUInt8(depModuleFunction, 16);
		prefix.writeUInt8(depModuleIndex, 17);
		prefix.writeUInt16LE(depModuleVersion, 18);
		const filler = Buffer.alloc(0x200, 0);
		const fwBuffer = Buffer.concat([prefix, filler, buffer, Buffer.alloc(length, 0)]);
		fwBuffer.writeUInt16LE(productId, fwBuffer.length - length);
		fwBuffer.writeUInt16LE(productVersion, fwBuffer.length - length + 2);
		fwBuffer.writeUInt16LE(0, fwBuffer.length - length + 4);
		fwBuffer.writeUInt16LE(length, fwBuffer.length - 2);

		const crc = crc32(fwBuffer);
		return Buffer.concat([fwBuffer, crc]);
	}
};
