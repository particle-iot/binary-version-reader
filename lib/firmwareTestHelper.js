'use strict';

const { randomFillSync } = require('crypto');
const ModuleInfo = require('./ModuleInfo');
const { updateModulePrefix, updateModuleSuffix, updateModuleSha256, updateModuleCrc32 } = require('./moduleEncoding');

/**
 * @typedef {object} FirmwareDependency
 * @property {number} func One of `ModuleInfo.FunctionType`
 * @property {number} index
 * @property {number} version
 */

/**
 * Options for `createFirmwareBinary()`. The product ID, product version and platform ID are left as `0xffff` when
 * not given.
 *
 * @typedef {object} CreateFirmwareBinaryOptions
 * @property {number} [productId]
 * @property {number} [productVersion]
 * @property {number} [platformId]
 * @property {number} [moduleFunction] One of `ModuleInfo.FunctionType`, defaults to `USER_PART`
 * @property {number} [moduleIndex]
 * @property {number} [moduleVersion]
 * @property {FirmwareDependency[]} [deps] Up to two dependencies
 * @property {boolean} [addVectorTable] Put `vectorTableSize` bytes before the module prefix
 * @property {number} [vectorTableSize]
 * @property {number} [moduleStartAddress]
 * @property {number} [dataSize] Size in bytes of the module data between the prefix and the suffix
 */

module.exports = {
	/**
	 * Creates a valid firmware binary for usage in tests. Half of the module data is random.
	 *
	 * @param {CreateFirmwareBinaryOptions} [options]
	 * @returns {Buffer}
	 */
	createFirmwareBinary({
			productId,
			productVersion,
			platformId,
			moduleFunction = ModuleInfo.FunctionType.USER_PART,
			moduleIndex = 1,
			moduleVersion = 1,
			deps = [],
			addVectorTable = false,
			vectorTableSize = 388,
			moduleStartAddress = 0x08000000,
			dataSize = 1024
		} = {}) {

		const prefixOffset = addVectorTable ? vectorTableSize : 0;
		const binary = Buffer.alloc(ModuleInfo.MODULE_PREFIX_SIZE + prefixOffset + dataSize + ModuleInfo.MIN_MODULE_SUFFIX_SIZE + 2 /* Product ID */ +
			2 /* Product version */ + 4 /* CRC-32 */, 0xff);
		// Part of the module data is filled with 0xff so that the module is compressible
		randomFillSync(binary, ModuleInfo.MODULE_PREFIX_SIZE + prefixOffset, Math.floor(dataSize / 2));

		updateModulePrefix(binary, {
			prefixOffset,
			moduleStartAddy: moduleStartAddress,
			moduleEndAddy: moduleStartAddress + binary.length - 4 /* CRC-32 */,
			reserved: 0,
			moduleFlags: 0,
			moduleVersion,
			platformID: platformId,
			moduleFunction,
			moduleIndex,
			depModuleFunction: (deps.length >= 1) ? deps[0].func : ModuleInfo.FunctionType.NONE,
			depModuleIndex: (deps.length >= 1) ? deps[0].index : 0,
			depModuleVersion: (deps.length >= 1) ? deps[0].version : 0,
			dep2ModuleFunction: (deps.length >= 2) ? deps[1].func : ModuleInfo.FunctionType.NONE,
			dep2ModuleIndex: (deps.length >= 2) ? deps[1].index : 0,
			dep2ModuleVersion: (deps.length >= 2) ? deps[1].version : 0
		});
		updateModuleSuffix(binary, {
			suffixSize: ModuleInfo.MIN_MODULE_SUFFIX_SIZE + 2 /* Product ID */ + 2 /* Product version */,
			productId,
			productVersion,
			reserved: 0
		});
		updateModuleSha256(binary);
		updateModuleCrc32(binary);
		return binary;
	}
};
