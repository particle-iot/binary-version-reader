const { Flags: ModuleFlags, MODULE_PREFIX_SIZE, MIN_MODULE_SUFFIX_SIZE } = require('./ModuleInfo.js');
const HalModuleParser = require('./HalModuleParser');

const crc32 = require('buffer-crc32');

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const deflateRawAsync = promisify(zlib.deflateRaw);
const inflateRawAsync = promisify(zlib.inflateRaw);

// Size of the `compressed_module_header` structure in Device OS
const COMPRESSED_MODULE_HEADER_SIZE = 8;

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

/**
 * Update the module's suffix data.
 *
 * Note: This function can't be used to change the size of the suffix data and it does not update
 * the checksums of the module.
 *
 * @param {Buffer} data Module data.
 * @param {Object} suffix Suffix info (see `HalModuleParser`).
 * @returns {Buffer}
 */
function updateModuleSuffix(data, suffix) {
	const size = suffix.suffixSize;
	// Some very old firmware binaries have a malformed suffix
	if (size === undefined || size === 0xffff || size < MIN_MODULE_SUFFIX_SIZE || size > MIN_MODULE_SUFFIX_SIZE + 6) {
		throw new RangeError('Invalid suffix size');
	}
	if (data.length < size + 4 /* CRC-32 */) {
		throw new RangeError('Invalid size of the module data');
	}
	let offs = data.length - size - 4;
	if (size > MIN_MODULE_SUFFIX_SIZE) {
		// Product ID
		let hasLongProductId = false;
		if (size == MIN_MODULE_SUFFIX_SIZE + 6) {
			hasLongProductId = true;
		} else if (size !== MIN_MODULE_SUFFIX_SIZE + 4) {
			throw new RangeError('Invalid suffix size');
		}
		if (suffix.productId !== undefined) {
			if (hasLongProductId) { // 32-bit product ID
				data.writeUInt16LE((suffix.productId >> 16) & 0xffff, offs);
				data.writeUInt16LE(suffix.productId & 0xffff, offs + 2);
			} else { // 16-bit product ID
				data.writeUInt16LE(suffix.productId, offs);
			}
		}
		offs += hasLongProductId ? 4 : 2;
		// Product version
		if (suffix.productVersion !== undefined) {
			data.writeUInt16LE(suffix.productVersion, offs);
		}
		offs += 2;
	}
	// Reserved field
	if (suffix.reserved !== undefined) {
		data.writeUInt16LE(suffix.reserved, offs);
	}
	offs += 2;
	// SHA-256 hash
	if (suffix.fwUniqueId !== undefined) {
		let hash = suffix.fwUniqueId;
		if (typeof hash === 'string') {
			hash = Buffer.from(hash, 'hex');
		}
		if (hash.length != 32) {
			throw new RangeError('Invalid size of the SHA-256 checksum');
		}
		hash.copy(data, offs);
	}
	offs += 32;
	// Suffix size
	offs = data.writeUInt16LE(size, offs);
	// CRC-32 checksum
	if (suffix.crcBlock !== undefined) {
		let crc = suffix.crcBlock;
		if (typeof crc === 'string') {
			crc = Buffer.from(crc, 'hex');
		}
		if (crc.length != 4) {
			throw new RangeError('Invalid size of the CRC-32 checksum');
		}
		crc.copy(data, offs);
	}
	offs += 4;
	return data;
}

/**
 * Compress the firmware module.
 *
 * @param {Buffer} data Module data.
 * @param {Object} [prefix] Prefix info (see `HalModuleParser`).
 * @param {Object} [suffix] Suffix info (see `HalModuleParser`).
 * @param {Object} [options] Compression options (https://nodejs.org/api/zlib.html#zlib_class_options).
 * @returns {Buffer}
 */
async function compressModule(data, prefix, suffix, options) {
	if (!prefix || !suffix) {
		const parser = new HalModuleParser();
		const { prefixInfo, suffixInfo } = await parser.parseBuffer({ fileBuffer: data });
		if (!prefix) {
			prefix = prefixInfo;
		}
		if (!suffix) {
			suffix = suffixInfo;
		}
	}
	let startAddr = prefix.moduleStartAddy;
	if (startAddr === undefined) {
		throw new RangeError('moduleStartAddy is missing');
	}
	if (typeof startAddr === 'string') {
		startAddr = Number.parseInt(startAddr, 16);
	}
	let endAddr = prefix.moduleEndAddy;
	if (endAddr === undefined) {
		throw new RangeError('moduleEndAddy is missing');
	}
	if (typeof endAddr === 'string') {
		endAddr = Number.parseInt(endAddr, 16);
	}
	let flags = prefix.moduleFlags;
	if (flags === undefined) {
		throw new RangeError('moduleFlags is missing');
	}
	if (flags & ModuleFlags.COMPRESSED) {
		throw new RangeError('Module is already compressed');
	}
	if (flags & ModuleFlags.COMBINED) {
		// Combined modules need to be compressed individually
		throw new RangeError('Can\'t compress a combined module');
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize === undefined) {
		throw new RangeError('suffixSize is missing');
	}
	// Some very old firmware binaries have a malformed suffix
	if (suffixSize === 0xffff) {
		throw new RangeError('Invalid suffix size');
	}
	let dataSize = endAddr - startAddr + 4 /* CRC-32 */;
	const prefixOffs = prefix.prefixOffset || 0;
	if (data.length < prefixOffs + MODULE_PREFIX_SIZE + suffixSize + 4 || data.length !== dataSize) {
		throw new RangeError('Invalid size of the module data');
	}
	let dataOffs = 0;
	if (flags & ModuleFlags.DROP_MODULE_INFO) {
		if (prefixOffs !== 0) {
			throw new RangeError('DROP_MODULE_INFO can\'t be set for a module with a vector table');
		}
		// Skip the prefix data
		dataOffs = MODULE_PREFIX_SIZE;
		dataSize -= MODULE_PREFIX_SIZE;
	}
	// Compress the module data
	// TODO: Investigate compressing the module data in place to optimize memory usage, or use some
	// chainable buffers implementation, e.g. https://www.npmjs.com/package/buffers
	let compData = await deflateRawAsync(data.slice(dataOffs, dataOffs + dataSize), options);
	const compDataSize = compData.length;
	const destBuf = Buffer.alloc(MODULE_PREFIX_SIZE + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize + 4);
	// Copy the prefix data
	let offs = 0;
	offs += data.copy(destBuf, offs, prefixOffs, prefixOffs + MODULE_PREFIX_SIZE);
	// Encode the header of the compressed data
	offs = destBuf.writeUInt16LE(COMPRESSED_MODULE_HEADER_SIZE, offs); // Header size
	offs = destBuf.writeUInt8(0, offs); // Compression method (raw Deflate)
	offs = destBuf.writeUInt8((options && options.windowBits) ? options.windowBits : 0, offs); // Window size
	offs = destBuf.writeUInt32LE(dataSize, offs); // Size of the uncompressed data
	// Copy the compressed data
	offs += compData.copy(destBuf, offs);
	compData = null;
	// Copy the suffix data
	const suffixOffs = data.length - suffixSize - 4;
	offs += data.copy(destBuf, offs, suffixOffs, suffixOffs + suffixSize);
	// Update the prefix data
	updateModulePrefix(destBuf, {
		moduleEndAddy: startAddr + MODULE_PREFIX_SIZE + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize, // CRC-32 is not included
		moduleFlags: flags | ModuleFlags.COMPRESSED
	});
	// Update the checksums
	updateModuleSha256(destBuf);
	updateModuleCrc32(destBuf);
	return destBuf;
}

/**
 * Decompress the firmware module.
 *
 * @param {Buffer} data Module data.
 * @param {Object} [prefix] Prefix info (see `HalModuleParser`).
 * @param {Object} [suffix] Suffix info (see `HalModuleParser`).
 * @returns {Buffer}
 */
async function decompressModule(data, prefix, suffix) {
	if (!prefix || !suffix) {
		const parser = new HalModuleParser();
		const { prefixInfo, suffixInfo } = await parser.parseBuffer({ fileBuffer: data });
		if (!prefix) {
			prefix = prefixInfo;
		}
		if (!suffix) {
			suffix = suffixInfo;
		}
	}
	let startAddr = prefix.moduleStartAddy;
	if (startAddr === undefined) {
		throw new RangeError('moduleStartAddy is missing');
	}
	if (typeof startAddr === 'string') {
		startAddr = Number.parseInt(startAddr, 16);
	}
	let endAddr = prefix.moduleEndAddy;
	if (endAddr === undefined) {
		throw new RangeError('moduleEndAddy is missing');
	}
	if (typeof endAddr === 'string') {
		endAddr = Number.parseInt(endAddr, 16);
	}
	let flags = prefix.moduleFlags;
	if (flags === undefined) {
		throw new RangeError('moduleFlags is missing');
	}
	if (!(flags & ModuleFlags.COMPRESSED)) {
		throw new RangeError('Module is not compressed');
	}
	if (flags & ModuleFlags.COMBINED) {
		// Combined modules need to be split and decompressed individually
		throw new RangeError('Can\'t decompress a combined module');
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize === undefined) {
		throw new RangeError('suffixSize is missing');
	}
	let dataSize = endAddr - startAddr + 4 /* CRC-32 */;
	const minModuleSize = MODULE_PREFIX_SIZE + COMPRESSED_MODULE_HEADER_SIZE + suffixSize + 4;
	if (data.length < minModuleSize || data.length != dataSize) {
		throw new RangeError('Invalid size of the module data');
	}
	// Parse the header of the compressed data
	let offs = MODULE_PREFIX_SIZE;
	const compHeaderSize = data.readUInt16LE(offs);
	if (compHeaderSize < COMPRESSED_MODULE_HEADER_SIZE) {
		throw new Error('Invalid size of the compressed data header');
	} else if (compHeaderSize > COMPRESSED_MODULE_HEADER_SIZE &&
			data.length < minModuleSize + compHeaderSize - COMPRESSED_MODULE_HEADER_SIZE) {
		throw new RangeError('Invalid size of the module data');
	}
	offs += 2;
	const compMethod = data.readUInt8(offs);
	if (compMethod !== 0) { // Raw Deflate
		throw new Error('Unknown compression method');
	}
	offs += 1;
	const windowBits = data.readUInt8(offs);
	if (windowBits !== 0 && !(windowBits >= 8 && windowBits <= 15)) { // Valid range for raw Deflate
		throw new Error('Invalid size of the decompression window');
	}
	offs += 1;
	const decompDataSize = data.readUInt32LE(offs);
	offs += 4;
	offs += compHeaderSize - COMPRESSED_MODULE_HEADER_SIZE; // Skip unknown fields if any
	// Decompress the module data
	dataSize -= MODULE_PREFIX_SIZE;
	const decompData = await inflateRawAsync(data.slice(offs, offs + dataSize));
	if (decompData.length != decompDataSize) {
		throw new Error('Unexpected size of the decompressed data');
	}
	let destBuf = decompData;
	if (flags & ModuleFlags.DROP_MODULE_INFO) {
		// Restore the prefix data
		destBuf = Buffer.alloc(MODULE_PREFIX_SIZE + decompData.length);
		data.copy(destBuf, 0, 0, MODULE_PREFIX_SIZE);
		decompData.copy(destBuf, MODULE_PREFIX_SIZE);
		updateModulePrefix(destBuf, {
			moduleEndAddy: startAddr + MODULE_PREFIX_SIZE + decompData.length - 4, // Exclude CRC-32
			moduleFlags: flags & ~ModuleFlags.COMPRESSED
		});
	}
	return destBuf;
}

module.exports = {
	updateModuleSha256,
	updateModuleCrc32,
	updateModulePrefix,
	updateModuleSuffix,
	compressModule,
	decompressModule
};
