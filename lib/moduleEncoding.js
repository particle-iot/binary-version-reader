const { MODULE_PREFIX_SIZE } = require('./ModuleInfo.js');

const crc32 = require('buffer-crc32');

const crypto = require('crypto');

/**
 * Compute and update the module's SHA-256 checksum.
 *
 * @param {Buffer} data Module data.
 * @returns {Buffer}
 */
function updateModuleSha256(data) {
	const suffixSize = 38; // Size of the SHA-256, CRC-32 and suffix size fields
	if (data.length < suffixSize) {
		throw new RangeError('Invalid size of the module data');
	}
	const shaOffs = data.length - suffixSize;
	let hash = crypto.createHash('sha256');
	hash.update(data.slice(0, shaOffs));
	hash = hash.digest();
	hash.copy(data, shaOffs);
	return data;
}

/**
 * Compute and update the module's CRC-32 checksum.
 *
 * @param {Buffer} data Module data.
 * @returns {Buffer}
 */
function updateModuleCrc32(data) {
	if (data.length < 4) {
		throw new RangeError('Invalid size of the module data');
	}
	const crcOffs = data.length - 4;
	const crc = crc32(data.slice(0, crcOffs));
	crc.copy(data, crcOffs);
	return data;
}

/**
 * Update the module's prefix data.
 *
 * Note: This function does not update the checksums of the module.
 *
 * @param {Buffer} data Module data.
 * @param {Object} prefix Prefix info (see `HalModuleParser`).
 * @returns {Buffer}
 */
function updateModulePrefix(data, prefix) {
	let offs = prefix.prefixOffset || 0;
	if (data.length < offs + MODULE_PREFIX_SIZE) {
		throw new RangeError('Invalid size of the module data');
	}
	// Start address
	if (prefix.moduleStartAddy !== undefined) {
		let addr = prefix.moduleStartAddy;
		if (typeof addr === 'string') { // HalModuleParser returns addresses as strings ¯\(ツ)/¯
			addr = Number.parseInt(addr, 16);
		}
		data.writeUInt32LE(addr, offs);
	}
	offs += 4;
	// End address
	if (prefix.moduleEndAddy !== undefined) {
		addr = prefix.moduleEndAddy;
		if (typeof addr === 'string') {
			addr = Number.parseInt(addr, 16);
		}
		data.writeUInt32LE(addr, offs);
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
	return data;
}

// TODO: updateModuleSuffix()

/**
 * Update the module data.
 *
 * This function updates the module data without modifying the original vector table, prefix, suffix
 * and CRC-32 fields.
 *
 * @param {Buffer} data Original module data.
 * @param {Buffer} newData New module data without prefix and suffix fields.
 * @param {Object} prefix Prefix info (see `HalModuleParser`).
 * @param {Object} suffix Suffix info (see `HalModuleParser`).
 * @returns {Buffer}
 */
function updateModuleData(data, newData, prefix, suffix) {
	if (suffix.suffixSize === undefined) {
		throw new RangeError('suffixSize is missing');
	}
	const prefixSize = (prefix.prefixOffset || 0) + MODULE_PREFIX_SIZE;
	const suffixSize = suffix.suffixSize + 4 /* CRC-32 */;
	if (data.length < prefixSize + suffixSize) {
		throw new RangeError('Invalid size of the module data');
	}
	const buf = Buffer.alloc(newData.length + prefixSize + suffixSize);
	data.copy(buf, 0, 0, prefixSize);
	data.copy(buf, buf.length - suffixSize, data.length - suffixSize);
	newData.copy(buf, prefixSize);
	return buf;
}

/**
 * Extract the module data.
 *
 * This function removes the vector table, prefix, suffix and CRC-32 fields from the module data
 * and returns the remaining data.
 *
 * @param {Buffer} data Module data.
 * @param {Object} prefix Prefix info (see `HalModuleParser`).
 * @param {Object} suffix Suffix info (see `HalModuleParser`).
 * @returns {Buffer}
 */
function extractModuleData(data, prefix, suffix) {
	if (suffix.suffixSize === undefined) {
		throw new RangeError('suffixSize is missing');
	}
	const prefixSize = (prefix.prefixOffset || 0) + MODULE_PREFIX_SIZE;
	const suffixSize = suffix.suffixSize + 4 /* CRC-32 */;
	if (data.length < prefixSize + suffixSize) {
		throw new RangeError('Invalid size of the module data');
	}
	return data.slice(prefixSize, data.length - suffixSize);
}

module.exports = {
	updateModuleSha256,
	updateModuleCrc32,
	updateModulePrefix,
	updateModuleData,
	extractModuleData
};
