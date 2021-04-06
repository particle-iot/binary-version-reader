const { Flags: ModuleFlags, CompressionMethod, PatchFormat, MODULE_PREFIX_SIZE, MIN_MODULE_SUFFIX_SIZE, MAX_MODULE_SUFFIX_SIZE } = require('./ModuleInfo.js');
const HalModuleParser = require('./HalModuleParser');
const { crc32 } = require('./utilities');

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const deflateRawAsync = promisify(zlib.deflateRaw);
const inflateRawAsync = promisify(zlib.inflateRaw);

// Size of the `compressed_module_header` structure in Device OS
const COMPRESSED_MODULE_HEADER_SIZE = 8;

// Size of the `patch_module_header` structure in Device OS
const PATCH_MODULE_HEADER_SIZE = 12;

function encodeCompressedModuleHeader(header) {
  let headerSize = COMPRESSED_MODULE_HEADER_SIZE;
  if (header.headerSize !== undefined) {
    headerSize = header.headerSize;
    if (headerSize !== COMPRESSED_MODULE_HEADER_SIZE) {
      throw new RangeError('Invalid size of the compressed module header');
    }
  }
  const method = header.method;
  if (method === undefined) {
    throw new Error('Missing compression method');
  }
  let windowBits = 0; // Use the default
  if (header.windowBits !== undefined) {
    windowBits = header.windowBits;
    if (method === CompressionMethod.RAW_DEFLATE && windowBits !== 0 && !(windowBits >= 8 && windowBits <= 15)) {
      throw new Error('Invalid size of the decompression window');
    }
  }
  const originalSize = header.originalSize;
  if (originalSize === undefined) {
    throw new Error('Missing size of the uncompressed module data');
  }
  const buf = Buffer.alloc(headerSize);
  let offs = 0;
  offs = buf.writeUInt16LE(headerSize, offs);
  offs = buf.writeUInt8(method, offs);
  offs = buf.writeUInt8(windowBits, offs);
  offs = buf.writeUInt32LE(originalSize, offs);
  return buf;
}

function decodeCompressedModuleHeader(buf) {
  if (data.length < COMPRESSED_MODULE_HEADER_SIZE) {
    throw new RangeError('Invalid size of the compressed module header');
  }
  let offs = 0;
  const headerSize = buf.readUInt16LE(offs);
  if (data.length < headerSize) {
    throw new RangeError('Invalid size of the compressed module header');
  }
  offs += 2;
  const method = buf.readUInt8(offs);
  offs += 1;
  const windowBits = buf.readUInt8(offs);
  if (method === CompressionMethod.RAW_DEFLATE && windowBits !== 0 && !(windowBits >= 8 && windowBits <= 15)) {
    throw new Error('Invalid size of the decompression window');
  }
  offs += 1;
  const originalSize = buf.readUInt32LE(offs);
  offs += 4;
  return { headerSize, method, windowBits, originalSize };
}

function encodePatchModuleHeader(header) {
  let headerSize = PATCH_MODULE_HEADER_SIZE;
  if (header.headerSize !== undefined) {
    headerSize = header.headerSize;
    if (headerSize !== PATCH_MODULE_HEADER_SIZE) {
      throw new RangeError('Invalid size of the patch module header');
    }
  }
  const format = header.format;
  if (format === undefined) {
    throw new Error('Missing patch format');
  }
  const sourceSize = header.sourceSize;
  if (sourceSize === undefined) {
    throw new Error('Missing size of the source module data');
  }
  const targetSize = header.targetSize;
  if (targetSize === undefined) {
    throw new Error('Missing size of the target module data');
  }
  const buf = Buffer.alloc(headerSize);
  let offs = 0;
  offs = buf.writeUInt16LE(headerSize, offs);
  offs = buf.writeUInt8(format, offs);
  offs = buf.writeUInt8(0, offs); // Reserved
  offs = buf.writeUInt32LE(sourceSize, offs);
  offs = buf.writeUInt32LE(targetSize, offs);
  return buf;
}

function decodePatchModuleHeader(buf) {
  if (data.length < PATCH_MODULE_HEADER_SIZE) {
    throw new RangeError('Invalid size of the patch module header');
  }
  let offs = 0;
  const headerSize = buf.readUInt16LE(offs);
  if (data.length < headerSize) {
    throw new RangeError('Invalid size of the patch module header');
  }
  offs += 2;
  const format = buf.readUInt8(offs);
  offs += 1;
  offs += 1; // Reserved
  const sourceSize = buf.readUInt32LE(offs);
  offs += 4;
  const targetSize = buf.readUInt32LE(offs);
  offs += 4;
  return { headerSize, format, sourceSize, targetSize };
}

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
	if (size === undefined || size < MIN_MODULE_SUFFIX_SIZE || size > MAX_MODULE_SUFFIX_SIZE) {
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
				data.writeUInt32LE(suffix.productId, offs);
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
 * @param {Object} [options] Options.
 * @param {Object} [options.zlib] Compression options (https://nodejs.org/api/zlib.html#zlib_class_options).
 * @param {Boolean} [options.updateCrc32] Update CRC-32 of the compressed module (default: `true`).
 * @param {Boolean} [options.updateSha256] Update SHA-256 of the compressed module (default: `true`).
 * @returns {Promise<Buffer>}
 */
async function compressModule(data, options) {
	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: data });
	let startAddr = prefix.moduleStartAddy;
	if (typeof startAddr === 'string') {
		startAddr = Number.parseInt(startAddr, 16);
	}
	let endAddr = prefix.moduleEndAddy;
	if (typeof endAddr === 'string') {
		endAddr = Number.parseInt(endAddr, 16);
	}
	const flags = prefix.moduleFlags;
	if (flags & ModuleFlags.COMPRESSED) {
		throw new RangeError('Module is already compressed');
	}
	if (flags & ModuleFlags.COMBINED) {
		// Combined modules need to be compressed individually
		throw new RangeError('Can\'t compress a combined module');
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
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
	let compData = await deflateRawAsync(data.slice(dataOffs, dataOffs + dataSize), options && options.zlib);
	const compDataSize = compData.length;
	// TODO: Consider using some linked buffers implementation to optimize memory usage,
	// e.g. https://www.npmjs.com/package/buffers
	const destBuf = Buffer.alloc(MODULE_PREFIX_SIZE + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize + 4);
	// Copy the prefix data
	let offs = 0;
	offs += data.copy(destBuf, offs, prefixOffs, prefixOffs + MODULE_PREFIX_SIZE);
	// Encode the header of the compressed data
	offs = destBuf.writeUInt16LE(COMPRESSED_MODULE_HEADER_SIZE, offs); // Header size
	offs = destBuf.writeUInt8(0, offs); // Compression method (raw Deflate)
	offs = destBuf.writeUInt8((options && options.zlib && options.zlib.windowBits) || 0, offs); // Window size
	offs = destBuf.writeUInt32LE(dataSize, offs); // Size of the uncompressed data
	// Copy the compressed data
	offs += compData.copy(destBuf, offs);
	compData = null;
	// Copy the suffix data
	const suffixOffs = data.length - suffixSize - 4;
	offs += data.copy(destBuf, offs, suffixOffs, suffixOffs + suffixSize + 4);
	// Update the prefix data
	updateModulePrefix(destBuf, {
		moduleEndAddy: startAddr + MODULE_PREFIX_SIZE + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize, // CRC-32 is not included
		moduleFlags: flags | ModuleFlags.COMPRESSED
	});
	// Update the checksums
	if (!options || options.updateSha256 === undefined || options.updateSha256) {
		updateModuleSha256(destBuf);
	}
	if (!options || options.updateCrc32 === undefined || options.updateCrc32) {
		updateModuleCrc32(destBuf);
	}
	return destBuf;
}

/**
 * Decompress the firmware module.
 *
 * @param {Buffer} data Module data.
 * @returns {Promise<Buffer>}
 */
async function decompressModule(data) {
	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: data });
	let startAddr = prefix.moduleStartAddy;
	if (typeof startAddr === 'string') {
		startAddr = Number.parseInt(startAddr, 16);
	}
	let endAddr = prefix.moduleEndAddy;
	if (typeof endAddr === 'string') {
		endAddr = Number.parseInt(endAddr, 16);
	}
	const flags = prefix.moduleFlags;
	if (!(flags & ModuleFlags.COMPRESSED)) {
		throw new RangeError('Module is not compressed');
	}
	if (flags & ModuleFlags.COMBINED) {
		// Combined modules need to be split and decompressed individually
		throw new RangeError('Can\'t decompress a combined module');
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
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

/**
 * Combine firmware modules.
 *
 * @param {Buffer[]} modules Module data.
 * @param {Object} [options] Options.
 * @param {Boolean} [options.updateCrc32] Update CRC-32 checksums of the combined modules (default: `true`).
 * @param {Boolean} [options.updateSha256] Update SHA-256 checksums of the combined modules (default: `true`).
 * @returns {Promise<Buffer>}
 */
async function combineModules(modules, options) {
	const parser = new HalModuleParser();
	const mods = [];
	let totalSize = 0;
	for (let data of modules) {
		const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
		let startAddr = prefix.moduleStartAddy;
		if (typeof startAddr === 'string') {
			startAddr = Number.parseInt(startAddr, 16);
		}
		let endAddr = prefix.moduleEndAddy;
		if (typeof endAddr === 'string') {
			endAddr = Number.parseInt(endAddr, 16);
		}
		if (data.length !== endAddr - startAddr + 4 /* CRC-32 */) {
			throw new RangeError('Invalid size of the module data');
		}
		const flags = prefix.moduleFlags;
		if (flags & ModuleFlags.COMBINED) {
			throw new RangeError('Module is already combined');
		}
		mods.push({ data, flags, prefixOffs: prefix.prefixOffset });
		totalSize += data.length;
	}
	if (!mods.length) {
		throw new RangeError('Modules array is empty');
	}
	if (mods.length === 1) {
		return mods[0].data;
	}
	// TODO: Consider using some linked buffers implementation to optimize memory usage,
	// e.g. https://www.npmjs.com/package/buffers
	const destBuf = Buffer.alloc(totalSize);
	let offs = 0;
	for (let i = 0; i < mods.length; ++i) {
		const mod = mods[i];
		mod.data.copy(destBuf, offs);
		// Set the COMBINED flag in each module's prefix data except for the last module
		if (i !== mods.length - 1) {
			const buf = destBuf.slice(offs, offs + mod.data.length);
			updateModulePrefix(buf, {
				moduleFlags: mod.flags | ModuleFlags.COMBINED,
				prefixOffset: mod.prefixOffs
			});
			// Update the checksums
			if (!options || options.updateSha256 === undefined || options.updateSha256) {
				updateModuleSha256(buf);
			}
			if (!options || options.updateCrc32 === undefined || options.updateCrc32) {
				updateModuleCrc32(buf);
			}
		}
		offs += mod.data.length;
	}
	return destBuf;
}

/**
 * Split combined firmware modules.
 *
 * @param {Buffer} data Module data.
 * @param {Object} [options] Options.
 * @param {Boolean} [options.updateCrc32] Update CRC-32 checksums of the combined modules (default: `true`).
 * @param {Boolean} [options.updateSha256] Update SHA-256 checksums of the combined modules (default: `true`).
 * @returns {Promise<Buffer[]>}
 */
async function splitCombinedModules(data, options) {
	if (!data.length) {
		throw new RangeError('Invalid size of the module data');
	}
	const parser = new HalModuleParser();
	const mods = [];
	let flags = 0;
	let offs = 0;
	do {
		if (data.length - offs < MODULE_PREFIX_SIZE + MIN_MODULE_SUFFIX_SIZE) {
			throw new RangeError('Invalid size of the module data');
		}
		const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data.slice(offs) });
		let startAddr = prefix.moduleStartAddy;
		if (typeof startAddr === 'string') {
			startAddr = Number.parseInt(startAddr, 16);
		}
		let endAddr = prefix.moduleEndAddy;
		if (typeof endAddr === 'string') {
			endAddr = Number.parseInt(endAddr, 16);
		}
		if (endAddr < startAddr) {
			throw new Error('Invalid module end address');
		}
		flags = prefix.moduleFlags;
		const size = endAddr - startAddr + 4 /* CRC-32 */;
		if (data.length - offs < size) {
			throw new RangeError('Invalid size of the module data');
		}
		const destBuf = Buffer.alloc(size);
		mods.push(destBuf);
		offs += data.copy(destBuf, 0, offs, offs + size);
		if (flags & ModuleFlags.COMBINED) {
			// Clear the COMBINED flag
			updateModulePrefix(destBuf, {
				moduleFlags: flags & ~ModuleFlags.COMBINED,
				prefixOffset: prefix.prefixOffset
			});
			// Update the checksums
			if (!options || options.updateSha256 === undefined || options.updateSha256) {
				updateModuleSha256(destBuf);
			}
			if (!options || options.updateCrc32 === undefined || options.updateCrc32) {
				updateModuleCrc32(destBuf);
			}
		} else {
			break;
		}
	} while (offs < data.length);
	if ((flags & ModuleFlags.COMBINED) || offs < data.length) {
		throw new Error('Invalid module data');
	}
	return mods;
}

async function transformModule(data, transform, options) {
	const parser = new HalModuleParser();
	let { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
	let { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: data });
	// Convert string addresses to numbers for convenience
	if (typeof prefix.moduleStartAddy === 'string') {
		prefix.moduleStartAddy = Number.parseInt(prefix.moduleStartAddy, 16);
	}
	if (typeof prefix.moduleEndAddy === 'string') {
		prefix.moduleEndAddy = Number.parseInt(prefix.moduleEndAddy, 16);
	}
	// Sanity checks
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
	}
	const prefixOffset = prefix.prefixOffset;
	if (data.length < prefixOffset + MODULE_PREFIX_SIZE + suffixSize + 4 /* CRC-32 */) {
		throw new RangeError('Invalid size of the module data');
	}
	const moduleFlags = prefix.moduleFlags;
	if ((moduleFlags & ModuleFlags.DROP_MODULE_INFO) && prefixOffset !== 0) {
		throw new RangeError('DROP_MODULE_INFO flag can\'t be set for a module with a vector table');
	}
	// Extract and update individual sections of the module binary
	let vectorTable = data.slice(0, prefixOffset);
	let firmwareData = data.slice(prefixOffset + MODULE_PREFIX_SIZE, prefixOffset + MODULE_PREFIX_SIZE + data.length -
			prefixOffset - MODULE_PREFIX_SIZE - suffixSize - 4 /* CRC-32 */);
	let patchHeader = null;
	let compressedHeader = null;
	if (moduleFlags & ModuleFlags.PATCH) {
		if (moduleFlags & ModuleFlags.COMPRESSED) {
			throw new RangeError('PATCH and COMPRESSED module flags can\'t be combined');
		}
		patchHeader = decodePatchModuleHeader(data.slice(prefixOffset + MODULE_PREFIX_SIZE));
	} else if (moduleFlags & ModuleFlags.COMPRESSED) {
		compressedHeader = decodeCompressedModuleHeader(data.slice(prefixOffset + MODULE_PREFIX_SIZE));
	}
	if (typeof transform === 'function') {
		let t = { prefix, suffix, firmwareData, vectorTable };
		if (patchHeader) {
			t.patchHeader = patchHeader;
		} else if (compressedHeader) {
			t.compressedHeader = compressedHeader;
		}
		t = await transform(t);
		if (t.prefix !== undefined) {
			prefix = t.prefix;
		}
		if (t.suffix !== undefined) {
			suffix = t.suffix;
		}
		if (t.firmwareData !== undefined) {
			firmwareData = t.firmwareData;
		}
		if (t.vectorTable !== undefined) {
			vectorTable = t.vectorTable;
		}
		if (t.patchHeader !== undefined) {
			patchHeader = t.patchHeader;
		} else if (t.compressedHeader !== undefined) {
			compressedHeader = t.compressedHeader;
		}
	} else if (transform) {
		if (transform.prefix !== undefined) {
			if (typeof transform.prefix === 'function') {
				prefix = await transform.prefix(prefix);
			} else {
				prefix = transform.prefix;
			}
		}
		if (transform.suffix !== undefined) {
			if (typeof transform.suffix === 'function') {
				suffix = await transform.suffix(suffix);
			} else {
				suffix = transform.suffix;
			}
		}
		if (transform.firmwareData !== undefined) {
			if (typeof transform.firmwareData === 'function') {
				firmwareData = await transform.firmwareData(firmwareData);
			} else {
				firmwareData = transform.firmwareData;
			}
		}
		if (transform.vectorTable !== undefined) {
			if (typeof transform.vectorTable === 'function') {
				vectorTable = await transform.vectorTable(vectorTable);
			} else {
				vectorTable = transform.vectorTable;
			}
		}
		if (transform.patchHeader !== undefined) {
			if (typeof transform.patchHeader === 'function') {
				patchHeader = await transform.patchHeader(patchHeader);
			} else {
				patchHeader = transform.patchHeader;
			}
		} else if (transform.compressedHeader !== undefined) {
			if (typeof transform.compressedHeader === 'function') {
				compressedHeader = await transform.compressedHeader(compressedHeader);
			} else {
				compressedHeader = transform.compressedHeader;
			}
		}
	}
	// Reassemble the module binary
	let header = null;
	if (patchHeader) {
		header = encodePatchModuleHeader(patchHeader);
	} else if (compressedHeader) {
		header = encodeCompressedModuleHeader(compressedHeader);
	}
	const headerSize = header ? header.length : 0;
	const buf = Buffer.alloc(vectorTable.length + MODULE_PREFIX_SIZE + headerSize + firmwareData.length + suffix.suffixSize + 4 /* CRC-32 */);
	let offs = 0;
	offs += vectorTable.copy(buf, offs); // Vector table
	prefix.prefixOffset = vectorTable.length;
	prefix.moduleEndAddy = prefix.moduleStartAddy + MODULE_PREFIX_SIZE + headerSize + firmwareData.length + suffix.suffixSize; // CRC-32 is not included
	updateModulePrefix(buf, prefix); // Module prefix
	offs += MODULE_PREFIX_SIZE;
	if (header) {
		offs += header.copy(buf, offs); // Patch/compressed header
	}
	offs += firmwareData.copy(buf, offs); // Firmware data
	updateModuleSuffix(buf, suffix); // Module suffix
	// Update the checksums
	if (!options || options.updateSha256 === undefined || options.updateSha256) {
		updateModuleSha256(buf);
	}
	if (!options || options.updateCrc32 === undefined || options.updateCrc32) {
		updateModuleCrc32(buf);
	}
	return buf;
}

module.exports = {
	updateModuleSha256,
	updateModuleCrc32,
	updateModulePrefix,
	updateModuleSuffix,
	compressModule,
	decompressModule,
	combineModules,
	splitCombinedModules,
	transformModule
};
