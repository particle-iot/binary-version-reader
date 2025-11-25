const { Flags: ModuleFlags, MODULE_PREFIX_SIZE, MIN_MODULE_SUFFIX_SIZE, MAX_MODULE_SUFFIX_SIZE, ModuleInfoExtension, ModuleFunction } = require('./ModuleInfo.js');
const HalModuleParser = require('./HalModuleParser');
const { crc32 } = require('./utilities');

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const ModuleInfo = require('./ModuleInfo.js');

const fs = require('fs');
const fsAsync = fs.promises;
const archiver = require('archiver');
const tmp = require('tmp-promise');

const deflateRawAsync = promisify(zlib.deflateRaw);
const inflateRawAsync = promisify(zlib.inflateRaw);

const { platformsById } = require('@particle/device-constants');
const { schema: pb } = require('@particle/device-os-protobuf');

const { Readable } = require('stream');
const unzip = require('unzipper');
const path = require('path');

const DEFAULT_START_ALIGNMENT = 8;

function moduleFunctionToString(func) {
	switch (func) {
		case ModuleInfo.FunctionType.NONE: {
			return 'none';
		}
		case ModuleInfo.FunctionType.RESOURCE: {
			return 'resource';
		}
		case ModuleInfo.FunctionType.BOOTLOADER: {
			return 'bootloader';
		}
		case ModuleInfo.FunctionType.MONO_FIRMWARE: {
			return 'monoFirmware';
		}
		case ModuleInfo.FunctionType.SYSTEM_PART: {
			return 'systemPart';
		}
		case ModuleInfo.FunctionType.USER_PART: {
			return 'userPart';
		}
		case ModuleInfo.FunctionType.SETTINGS: {
			return 'settings';
		}
		case ModuleInfo.FunctionType.NCP_FIRMWARE: {
			return 'ncpFirmware';
		}
		case ModuleInfo.FunctionType.RADIO_STACK: {
			return 'radioStack';
		}
		case ModuleInfo.FunctionType.ASSET: {
			return 'asset';
		}
		default: {
			throw new RangeError('Unknown module function');
		}
	}
}

function firmwareModuleInfoForPlatformAndFunction(id, func, index) {
	const p = platformsById[id];
	if (!p) {
		throw new RangeError(`Unknown platform ID: ${id}`);
	}
	if (!p.firmwareModules) {
		return null;
	}
	const type = moduleFunctionToString(func);
	for (let m of p.firmwareModules) {
		if (m.type === type) {
			if (index === undefined || m.index === undefined || index === m.index) {
				return m;
			}
		}
	}
	return null;
}

/**
 * An error reported when assets are over the platform-specific limits
 */
class AssetLimitError extends Error {
	constructor(details, ...args) {
		super(...args);
		this.name = this.constructor.name;
		this.details = details;
	}
}

/**
 * An error reported when module data is over the platform-specific limits
 */
class PlatformLimitError extends Error {
	constructor(details, ...args) {
		super(...args);
		this.name = this.constructor.name;
		this.details = details;
	}
}


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
	if (prefix.moduleFlags !== undefined && (prefix.moduleFlags & ModuleInfo.Flags.PREFIX_EXTENSIONS)) {
		if (prefix.extensions) {
			// Validate size
			const expectedSize = calculateModulePrefixSize(prefix);
			if (expectedSize !== prefix.prefixSize) {
				// A sanity check to see whether the caller has resized the Buffer and already expects a certain
				// prefix size.
				throw new RangeError(`Extensions will not fit current prefix without resizing ${expectedSize} != ${prefix.prefixSize}`);
			}
			for (let ext of prefix.extensions) {
				if (ext.data) {
					ext.data.copy(data, offs);
					offs += ext.data.length;
				} else {
					const extData = encodeModuleExtension(ext);
					extData.copy(data, offs);
					offs += extData.length;
				}
			}
		}
	}
	return data;
}

/**
 * Calculate size of suffix data.
 *
 * @param {Object} suffix Suffix info (see `HalModuleParser`).
 * @returns {Number}
 */
function calculateModuleSuffixSize(suffix) {
	let size = ModuleInfo.MIN_MODULE_SUFFIX_SIZE;
	let seenProductExtension = false;
	if (suffix.extensions && suffix.extensions.length > 0) {
		for (let ext of suffix.extensions) {
			size += encodeModuleExtension(ext).length;
			if (ext.type === ModuleInfo.ModuleInfoExtension.PRODUCT_DATA) {
				seenProductExtension = true;
			}
		}
	}
	if (!seenProductExtension) {
		// For compatibility purposes add raw product id/version data
		size += 4;
	}
	return size;
}

/**
 * Calculate size of prefix data.
 *
 * @param {Object} suffix Prefix info (see `HalModuleParser`).
 * @returns {Number}
 */
function calculateModulePrefixSize(prefix) {
	let size = ModuleInfo.MODULE_PREFIX_SIZE;
	if (prefix.moduleFlags !== undefined && (prefix.moduleFlags & ModuleInfo.Flags.PREFIX_EXTENSIONS) &&
			prefix.extensions && prefix.extensions.length > 0) {
		for (let ext of prefix.extensions) {
			size += encodeModuleExtension(ext).length;
		}
	}
	return size;
}

/**
 * Sanitize address type to Number.
 *
 * @param {Object} address Address either as a string or number
 * @returns {Number}
 */
function sanitizeAddress(address) {
	if (typeof address === 'string') {
		address = Number.parseInt(address, 16);
	}
	return address;
}


/**
 * Encode module extension.
 *
 * @param {Object} extension Extension data (see `HalModuleParser`).
 * @returns {Buffer}
 */
function encodeModuleExtension(extension) {
	const EXTENSION_HEADER_SIZE = 4;
	let idx = 0;
	let buffer;
	switch (extension.type) {
		case ModuleInfo.ModuleInfoExtension.PRODUCT_DATA: {
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 6);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt16LE(0xffff, idx);
			idx += 2;
			buffer.writeUInt16LE(extension.productId, idx);
			idx += 2;
			buffer.writeUInt16LE(extension.productVersion, idx);
			break;
		}
		case ModuleInfo.ModuleInfoExtension.DYNAMIC_LOCATION: {
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 12);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUint32LE(sanitizeAddress(extension.moduleStartAddress), idx);
			idx += 4;
			buffer.writeUint32LE(sanitizeAddress(extension.dynalibLoadAddress), idx);
			idx += 4;
			buffer.writeUint32LE(sanitizeAddress(extension.dynalibStartAddress), idx);
			break;
		}
		case ModuleInfo.ModuleInfoExtension.DEPENDENCY: {
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 8);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt8(extension.moduleFunction, idx);
			idx += 1;
			buffer.writeUInt8(extension.moduleIndex, idx);
			idx += 1;
			buffer.writeUInt16LE(extension.moduleVersion, idx);
			idx += 2;
			buffer.writeUInt32LE(extension.targetId, idx);
			break;
		}
		case ModuleInfo.ModuleInfoExtension.HASH: {
			let hash = extension.hash;
			if (typeof hash === 'string') {
				hash = Buffer.from(hash, 'hex');
			}
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + 2 + hash.length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt8(extension.hashType ? extension.hashType : ModuleInfo.ModuleInfoHashExtensionType.SHA256, idx);
			idx += 1;
			buffer.writeUInt8(hash.length, idx);
			idx += 1;
			hash.copy(buffer, idx);
			break;
		}
		case ModuleInfo.ModuleInfoExtension.NAME: {
			const name = Buffer.from(extension.name, 'utf8');
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + name.length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			name.copy(buffer, idx);
			break;
		}
		case ModuleInfo.ModuleInfoExtension.ASSET_DEPENDENCY: {
			let hash = extension.hash;
			if (typeof hash === 'string') {
				hash = Buffer.from(hash, 'hex');
			}
			const name = Buffer.from(extension.name, 'utf8');
			buffer = Buffer.alloc(EXTENSION_HEADER_SIZE + name.length + hash.length + 2);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUInt8(extension.hashType ? extension.hashType : ModuleInfo.ModuleInfoHashExtensionType.SHA256, idx);
			idx += 1;
			buffer.writeUInt8(hash.length, idx);
			idx += 1;
			hash.copy(buffer, idx);
			idx += hash.length;
			name.copy(buffer, idx);
			break;
		}
		case ModuleInfo.ModuleInfoExtension.END: {
			let length = EXTENSION_HEADER_SIZE;
			if (extension.padding) {
				length += extension.padding;
			} else if (extension.data) {
				// Use same padding
				length = extension.data.length;
			}
			buffer = Buffer.alloc(length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			break;
		}
		case ModuleInfo.ModuleInfoExtension.SECURITY_MODE: {
			let length = EXTENSION_HEADER_SIZE + 1;
			if (extension.certificate) {
				// This needs to be a buffer
				length += extension.certificate.length;
			}
			buffer = Buffer.alloc(length);
			buffer.writeUint16LE(extension.type, idx);
			idx += 2;
			buffer.writeUint16LE(buffer.length, idx);
			idx += 2;
			buffer.writeUint8(extension.securityMode, idx);
			idx += 1;
			if (extension.certificate) {
				extension.certificate.copy(buffer, idx);
			}
			break;
		}
		default: {
			if (extension.data && extension.data.length >= EXTENSION_HEADER_SIZE) {
				buffer = extension.data;
			} else {
				throw new RangeError('Unknown extension type');
			}
		}
	}
	return buffer;
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
	let productOffs = offs;
	if (suffix.extensions) {
		const expectedSize = calculateModuleSuffixSize(suffix);
		if (expectedSize !== size) {
			// A sanity check to see whether the caller has resized the Buffer and already expects a certain
			// suffix size.
			throw new RangeError(`Extensions will not fit current suffix without resizing`);
		}
		let updatedProductOffs = false;
		for (let ext of suffix.extensions) {
			if (ext.data) {
				ext.data.copy(data, offs);
				offs += ext.data.length;
			} else {
				const extData = encodeModuleExtension(ext);
				extData.copy(data, offs);
				offs += extData.length;
			}
			// FIXME: This is not ideal, but by design product data extension
			// is at the same location as standalone product data on platforms
			// that don't have suffix extensions
			if (ext.type === ModuleInfoExtension.PRODUCT_DATA) {
				productOffs = offs - 4;
				updatedProductOffs = true;
			}
		}
		if (!updatedProductOffs) {
			productOffs = offs;
		}
	}
	offs = productOffs;
	if (size >= MIN_MODULE_SUFFIX_SIZE + 4) {
		// Product ID
		if (suffix.productId !== undefined) {
			// 16-bit product ID
			data.writeUInt16LE(suffix.productId, offs);
		}
		offs += 2;
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
	const prefixSize = prefix.prefixSize;
	if (prefixSize < MODULE_PREFIX_SIZE) {
		throw new RangeError('Invalid prefix data');
	}
	if (flags & ModuleFlags.DROP_MODULE_INFO) {
		if (prefixOffs !== 0) {
			throw new RangeError('DROP_MODULE_INFO can\'t be set for a module with a vector table');
		}
		// Skip the prefix data
		dataOffs = prefixSize;
		dataSize -= prefixSize;
		// No need to keep suffix around within the compressed section either
		dataSize -= suffixSize + 4 /* CRC-32 */;
	}
	// Compress the module data
	let compData = await deflateRawAsync(data.slice(dataOffs, dataOffs + dataSize), options && options.zlib);
	const compDataSize = compData.length;
	// TODO: Consider using some linked buffers implementation to optimize memory usage,
	// e.g. https://www.npmjs.com/package/buffers
	const destBuf = Buffer.alloc(prefixSize + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize + 4);
	// Copy the prefix data
	let offs = 0;
	offs += data.copy(destBuf, offs, prefixOffs, prefixOffs + prefixSize);
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
		moduleEndAddy: startAddr + prefixSize + COMPRESSED_MODULE_HEADER_SIZE + compDataSize + suffixSize, // CRC-32 is not included
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
 * Add new extensions to module prefix or suffix depending on the platform.
 *
 * @param {Buffer} module Module to update
 * @param {Array} exts List of extensions to add
 * @param {Boolean} replaceWithSameType Append extensions as-is or replace existing extensions of the same type
 * @returns {Promise<Buffer>}
 */
async function addModuleExtensions({ module, exts = [], replaceWithSameType = false } = {}) {
	if (exts.length === 0) {
		throw new RangeError('Empty extension list');
	}

	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: module });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: module });
	prefix.moduleStartAddy = sanitizeAddress(prefix.moduleStartAddy);
	prefix.moduleEndAddy = sanitizeAddress(prefix.moduleEndAddy);
	const flags = prefix.moduleFlags;
	if (flags & ModuleFlags.COMPRESSED) {
		throw new RangeError(`Can't add extensions to a compressed module`);
	}
	if (flags & ModuleFlags.COMBINED) {
		throw new RangeError(`Can\'t add extensions to a combined module`);
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
	}
	let dataSize = prefix.moduleEndAddy - prefix.moduleStartAddy + 4 /* CRC-32 */;
	const prefixOffs = prefix.prefixOffset || 0;
	if (module.length < prefixOffs + MODULE_PREFIX_SIZE + suffixSize + 4 || module.length !== dataSize) {
		throw new RangeError('Invalid size of the module data');
	}

	const moduleInfo = firmwareModuleInfoForPlatformAndFunction(prefix.platformID, prefix.moduleFunction, prefix.moduleIndex);
	let extensionsInPrefix = false;
	if ((prefix.moduleFlags & ModuleInfo.Flags.PREFIX_EXTENSIONS) || (moduleInfo && moduleInfo.growsLeft)) {
		extensionsInPrefix = true;
	}

	let extensions = [];
	if (extensionsInPrefix) {
		extensions = prefix.extensions;
	} else {
		extensions = suffix.extensions;
	}
	if (!extensions) {
		extensions = [];
	}

	if (replaceWithSameType) {
		extensions = extensions.filter((val) => {
			for (let ext of exts) {
				if (val.type === ext.type) {
					return false;
				}
			}
			return true;
		});
	}

	let buffer = null;

	if (extensionsInPrefix) {
		extensions = extensions.concat(exts);
		prefix.extensions = extensions;
	} else {
		extensions = exts.concat(extensions);
		suffix.extensions = extensions;
	}

	// Always add END extension: it is mandatory to be present in module prefix extensions
	// and due to the fact that product data for some of the platforms may not use an extension and just be
	// raw data, to indicate end we will also use END extension here.
	if (extensions.length > 0 && extensions[extensions.length - 1].type !== ModuleInfo.ModuleInfoExtension.END &&
			extensions[extensions.length - 1].type !== ModuleInfo.ModuleInfoExtension.PRODUCT_DATA) {
		extensions.push({
			type: ModuleInfo.ModuleInfoExtension.END
		});
	}

	if (extensionsInPrefix && extensions.length > 0) {
		if (prefixOffs > 0) {
			throw new RangeError('Extensions in prefix are not supported for modules with non-zero prefix offset');
		}
		prefix.moduleFlags |= ModuleInfo.Flags.PREFIX_EXTENSIONS;
		prefix.extensions = extensions;
		const originalPrefixSize = prefix.prefixSize;
		prefix.prefixSize = calculateModulePrefixSize(prefix);

		let newSize = module.length + (prefix.prefixSize - originalPrefixSize);
		let newStartAddr = prefix.moduleEndAddy - (newSize - 4);
		let alignment = 0;
		if (newStartAddr % DEFAULT_START_ALIGNMENT !== 0) {
			alignment = (newStartAddr % DEFAULT_START_ALIGNMENT);
			newSize += alignment;
		}

		extensions[extensions.length - 1].padding = alignment;

		prefix.prefixSize += alignment;

		buffer = Buffer.alloc(newSize);
		module.copy(buffer, prefix.prefixSize, originalPrefixSize /* source offset */);
		prefix.moduleStartAddy = prefix.moduleEndAddy - (buffer.length - 4);

		if (suffix.extensions) {
			for (let ext of suffix.extensions) {
				if (ext.type === ModuleInfo.ModuleInfoExtension.DYNAMIC_LOCATION) {
					// This has to be updated for certain platforms if start address is moved
					delete ext.data;
					ext.moduleStartAddress = prefix.moduleStartAddy;
				}
			}
		}
	} else if (extensions.length > 0) {
		// In suffix
		suffix.extensions = extensions;
		const originalSuffixSize = suffix.suffixSize;
		suffix.suffixSize = calculateModuleSuffixSize(suffix);

		buffer = Buffer.alloc(module.length + (suffix.suffixSize - originalSuffixSize));
		module.copy(buffer, 0, 0, module.length - originalSuffixSize - 4 /* CRC-32 */);
		prefix.moduleEndAddy = prefix.moduleStartAddy + buffer.length - 4;
	}

	if (moduleInfo && moduleInfo.maxSize) {
		if (buffer.length > moduleInfo.maxSize) {
			throw new PlatformLimitError({}, 'Resulting module exceeds platform size limits');
		}
	}

	updateModulePrefix(buffer, prefix);
	updateModuleSuffix(buffer, suffix);
	updateModuleSha256(buffer);
	updateModuleCrc32(buffer);

	return buffer;
}

/**
 * Remove extensions of a particular type.
 *
 * @param {Buffer} module Module to update
 * @param {Array} exts List of extensions to add
 * @param {Boolean} replaceWithSameType Append extensions as-is or replace existing extensions of the same type
 * @returns {Promise<Buffer>}
 */
async function removeModuleExtensions({ module, exts = [] } = {}) {
	if (exts.length === 0) {
		throw new RangeError('Empty extension list');
	}

	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: module });
	const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: module });
	prefix.moduleStartAddy = sanitizeAddress(prefix.moduleStartAddy);
	prefix.moduleEndAddy = sanitizeAddress(prefix.moduleEndAddy);
	const flags = prefix.moduleFlags;
	if (flags & ModuleFlags.COMPRESSED) {
		throw new RangeError(`Can't add extensions to a compressed module`);
	}
	if (flags & ModuleFlags.COMBINED) {
		throw new RangeError(`Can\'t add extensions to a combined module`);
	}
	const suffixSize = suffix.suffixSize;
	if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
		throw new RangeError('Invalid suffix size');
	}
	let dataSize = prefix.moduleEndAddy - prefix.moduleStartAddy + 4 /* CRC-32 */;
	const prefixOffs = prefix.prefixOffset || 0;
	if (module.length < prefixOffs + MODULE_PREFIX_SIZE + suffixSize + 4 || module.length !== dataSize) {
		throw new RangeError('Invalid size of the module data');
	}

	const moduleInfo = firmwareModuleInfoForPlatformAndFunction(prefix.platformID, prefix.moduleFunction, prefix.moduleIndex);
	let extensionsInPrefix = false;
	if ((prefix.moduleFlags & ModuleInfo.Flags.PREFIX_EXTENSIONS) || (moduleInfo && moduleInfo.growsLeft)) {
		extensionsInPrefix = true;
	}

	let extensions = [];
	if (extensionsInPrefix) {
		extensions = prefix.extensions;
	} else {
		extensions = suffix.extensions;
	}
	if (!extensions) {
		extensions = [];
	}

	extensions = extensions.filter((val) => {
		for (let ext of exts) {
			if (val.type === ext) {
				return false;
			}
		}
		return true;
	});

	let buffer = null;

	if (extensionsInPrefix) {;
		prefix.extensions = extensions;
	} else {
		suffix.extensions = extensions;
	}

	// Always add END extension: it is mandatory to be present in module prefix extensions
	// and due to the fact that product data for some of the platforms may not use an extension and just be
	// raw data, to indicate end we will also use END extension here.
	if (extensions.length > 0 && extensions[extensions.length - 1].type !== ModuleInfo.ModuleInfoExtension.END &&
			extensions[extensions.length - 1].type !== ModuleInfo.ModuleInfoExtension.PRODUCT_DATA) {
		extensions.push({
			type: ModuleInfo.ModuleInfoExtension.END
		});
	}

	if (extensionsInPrefix && extensions.length > 0) {
		if (prefixOffs > 0) {
			throw new RangeError('Extensions in prefix are not supported for modules with non-zero prefix offset');
		}
		prefix.moduleFlags |= ModuleInfo.Flags.PREFIX_EXTENSIONS;
		prefix.extensions = extensions;
		const originalPrefixSize = prefix.prefixSize;
		delete extensions[extensions.length - 1].data;
		delete extensions[extensions.length - 1].length;
		prefix.prefixSize = calculateModulePrefixSize(prefix);

		let newSize = module.length + (prefix.prefixSize - originalPrefixSize);
		let newStartAddr = prefix.moduleEndAddy - (newSize - 4);
		let alignment = 0;
		if (newStartAddr % DEFAULT_START_ALIGNMENT !== 0) {
			alignment = (newStartAddr % DEFAULT_START_ALIGNMENT);
			newSize += alignment;
		}

		extensions[extensions.length - 1].padding = alignment;

		prefix.prefixSize += alignment;

		buffer = Buffer.alloc(newSize);
		module.copy(buffer, prefix.prefixSize, originalPrefixSize /* source offset */);
		prefix.moduleStartAddy = prefix.moduleEndAddy - (buffer.length - 4);

		if (suffix.extensions) {
			for (let ext of suffix.extensions) {
				if (ext.type === ModuleInfo.ModuleInfoExtension.DYNAMIC_LOCATION) {
					// This has to be updated for certain platforms if start address is moved
					delete ext.data;
					ext.moduleStartAddress = prefix.moduleStartAddy;
				}
			}
		}
	} else if (extensions.length > 0) {
		// In suffix
		suffix.extensions = extensions;
		const originalSuffixSize = suffix.suffixSize;
		suffix.suffixSize = calculateModuleSuffixSize(suffix);

		buffer = Buffer.alloc(module.length + (suffix.suffixSize - originalSuffixSize));
		module.copy(buffer, 0, 0, module.length - originalSuffixSize - 4 /* CRC-32 */);
		prefix.moduleEndAddy = prefix.moduleStartAddy + buffer.length - 4;
	}

	if (moduleInfo && moduleInfo.maxSize) {
		if (buffer.length > moduleInfo.maxSize) {
			throw new PlatformLimitError({}, 'Resulting module exceeds platform size limits');
		}
	}

	updateModulePrefix(buffer, prefix);
	updateModuleSuffix(buffer, suffix);
	updateModuleSha256(buffer);
	updateModuleCrc32(buffer);

	return buffer;
}

/**
 * list extensions of a particular type.
 *
 * @param {Buffer} module Module to update
 * @param {Array} exts List of extensions to add
 * @returns {Promise<[]>}
 */
async function listModuleExtensions({ module, exts = [] } = {}) {
  if (exts.length === 0) {
    throw new RangeError('Empty extension list');
  }

  const parser = new HalModuleParser();
  const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: module });
  const { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: module });
  prefix.moduleStartAddy = sanitizeAddress(prefix.moduleStartAddy);
  prefix.moduleEndAddy = sanitizeAddress(prefix.moduleEndAddy);
  const flags = prefix.moduleFlags;
  if (flags & ModuleFlags.COMPRESSED) {
    throw new RangeError(`Can't add extensions to a compressed module`);
  }
  if (flags & ModuleFlags.COMBINED) {
    throw new RangeError(`Can\'t add extensions to a combined module`);
  }
  const suffixSize = suffix.suffixSize;
  if (suffixSize < MIN_MODULE_SUFFIX_SIZE || suffixSize > MAX_MODULE_SUFFIX_SIZE) {
    throw new RangeError('Invalid suffix size');
  }
  let dataSize = prefix.moduleEndAddy - prefix.moduleStartAddy + 4 /* CRC-32 */;
  const prefixOffs = prefix.prefixOffset || 0;
  if (module.length < prefixOffs + MODULE_PREFIX_SIZE + suffixSize + 4 || module.length !== dataSize) {
    throw new RangeError('Invalid size of the module data');
  }

  const moduleInfo = firmwareModuleInfoForPlatformAndFunction(prefix.platformID, prefix.moduleFunction, prefix.moduleIndex);
  let extensionsInPrefix = false;
  if ((prefix.moduleFlags & ModuleInfo.Flags.PREFIX_EXTENSIONS) || (moduleInfo && moduleInfo.growsLeft)) {
    extensionsInPrefix = true;
  }

  let extensions = [];
  if (extensionsInPrefix) {
    extensions = prefix.extensions;
  } else {
    extensions = suffix.extensions;
  }
  if (!extensions) {
    extensions = [];
  }

  extensions = extensions.filter((val) => {
    for (let ext of exts) {
      if (val.type === ext) {
        return true;
      }
    }
    return false;
  });

  return extensions;
}


/**
 * Update module info to include a set of asset dependencies
 *
 * @param {Buffer} data Module to update
 * @param {Array} assets List of assets to add as dependencies
 * @returns {Promise<Buffer>}
 */
async function updateModuleAssetDependencies(data, assets) {
	if (assets.length === 0) {
		throw new RangeError('Empty asset dependency list');
	}

	assets = await Promise.all(assets.map(async (asset) => {
		let name;
		let hash;
		if (asset.name) {
			name = asset.name;
			hash = asset.hash;
		}
		if (!hash && asset.data) {
			let moduleInfo;
			const parser = new HalModuleParser();
			try {
				const fileInfo = await parser.parseBuffer({ fileBuffer: asset.data });

				if (fileInfo.crc && fileInfo.crc.ok) {
					// Looking like a valid module
					moduleInfo = {
						prefix: fileInfo.prefixInfo,
						suffix: fileInfo.suffixInfo
					};
				}
			} catch (error) {
				// Ignore
			}
			let parsed = false;
			if (moduleInfo) {
				const extensions = [].concat(moduleInfo.prefix.extensions || []).concat(moduleInfo.suffix.extensions || []);
				if (moduleInfo.prefix.moduleFunction === ModuleInfo.FunctionType.ASSET && extensions.length > 0) {
					for (let ext of extensions) {
						if (ext.type === ModuleInfo.ModuleInfoExtension.HASH) {
							hash = ext.hash;
						} else if (ext.type === ModuleInfo.ModuleInfoExtension.NAME) {
							name = ext.name;
						}
						if (name && hash) {
							parsed = true;
							break;
						}
					}
				}
			}
			if (!parsed) {
				// Raw asset data
				hash = crypto.createHash('sha256');
				hash.update(asset.data);
				hash = hash.digest();
			}
		}
		if (!name || !hash) {
			throw new RangeError('Invalid asset information');
		}
		const ext = {
			type: ModuleInfo.ModuleInfoExtension.ASSET_DEPENDENCY,
			hashType: ModuleInfo.ModuleInfoHashExtensionType.SHA256,
			hash: hash,
			name: name
		};
		return ext;
	}));

	try {
		return await addModuleExtensions({ module: data, exts: assets, replaceWithSameType: true });
	} catch (e) {
		if (e instanceof PlatformLimitError) {
			throw new AssetLimitError(e.details, e.message);
		}
		throw e;
	}
}

/**
 * Create asset module from raw asset data
 *
 * @param {Buffer} data Asset data.
 * @param {Object} [options] Options.
 * @param {Object} [options.zlib] Compression options (https://nodejs.org/api/zlib.html#zlib_class_options).
 * @param {Boolean} [options.compress] Compress resulting module (default = true)
 * @param {Buffer} [options.hash] Asset hash.
 * @param {String} name Asset name
 * @returns {Promise<Buffer>}
 */
async function createAssetModule(data, name, options) {
	let hash = options?.hash;
	if (hash) {
		if (!Buffer.isBuffer(hash) || hash.length !== 32) {
			throw new Error('Invalid asset hash');
		}
	} else {
		hash = crypto.createHash('sha256').update(data).digest();
	}

	const suffixInfo = {
		extensions: [
			{
				type: ModuleInfo.ModuleInfoExtension.HASH,
				hash: hash,
				hashType: ModuleInfo.ModuleInfoHashExtensionType.SHA256
			},
			{
				type: ModuleInfo.ModuleInfoExtension.NAME,
				name: name
			},
			{
				// For compatibility
				type: ModuleInfo.ModuleInfoExtension.PRODUCT_DATA,
				productId: 0xffff,
				productVersion: 0xffff
			}
		]
	};
	suffixInfo.suffixSize = calculateModuleSuffixSize(suffixInfo);

	let buffer = Buffer.alloc(MODULE_PREFIX_SIZE + suffixInfo.suffixSize + data.length + 4 /* CRC-32 */);
	// Generate module prefix and suffix
	const prefixInfo = {
		moduleStartAddy: 0,
		moduleEndAddy: buffer.length - 4,
		moduleFunction: ModuleInfo.FunctionType.ASSET,
		moduleFlags: ModuleInfo.Flags.DROP_MODULE_INFO
	};

	data.copy(buffer, MODULE_PREFIX_SIZE);
	updateModulePrefix(buffer, prefixInfo);
	updateModuleSuffix(buffer, suffixInfo);
	updateModuleSha256(buffer);
	updateModuleCrc32(buffer);

	if (!options || options.compress === undefined || options.compress) {
		buffer = await compressModule(buffer, options);
	}

	return buffer;
}


/**
 * Unwrap asset module to raw asset data
 *
 * @param {Buffer} data Asset module
 * @returns {Promise<Buffer>}
 */
async function unwrapAssetModule(data) {
	const parser = new HalModuleParser();
	let { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: data });
	let { suffixInfo: suffix } = await parser.parseSuffix({ fileBuffer: data });
	if (prefix.moduleFunction !== ModuleInfo.FunctionType.ASSET) {
		throw new RangeError('Invalid module function type');
	}
	if (!(prefix.moduleFlags & ModuleInfo.Flags.DROP_MODULE_INFO)) {
		throw new RangeError('Asset modules should contain DROP_MODULE_INFO flag');
	}
	if (prefix.moduleFlags & ModuleInfo.Flags.COMPRESSED) {
		data = await decompressModule(data);
	}
	return data.slice(prefix.prefixSize, data.length - 4 - suffix.suffixSize);
}

/**
 * Validate asset limits
 *
 * @param {Buffer|string} application Application binary buffer/path
 * @param {Array.<object>|Array.<string>} assets Asset data or paths
 * @returns {object}
 */

async function validateAssetLimits(application, assets) {
	let app = {};
	if (typeof application === 'string') {
		app.name = path.basename(application);
		app.data = await fsAsync.readFile(application);
	} else if (application.data && application.name) {
		app = application;
	} else {
		app = {
			data: application,
			name: 'application.bin'
		};
	}

	const parser = new HalModuleParser();
	const { prefixInfo: prefix } = await parser.parsePrefix({ fileBuffer: app.data });
	prefix.moduleStartAddy = sanitizeAddress(prefix.moduleStartAddy);
	prefix.moduleEndAddy = sanitizeAddress(prefix.moduleEndAddy);

	const p = platformsById[prefix.platformID];
	if (!p) {
		throw new RangeError(`Unknown platform ID: ${prefix.platformID}`);
	}

	if (!p.assets) {
		throw new RangeError('This platform does not support assets');
	}

	const storageLimit = p.assets.blockSize * (p.assets.storageTotalBlocks - p.assets.reservedBlocks);
	const errors = [];

	const processedAssets = [];
	let totalSize = 0;
	if (assets) {
		for (let asset of assets) {
			if (typeof asset === 'string') {
				const data = await fsAsync.readFile(asset);
				asset = {
					data: data,
					name: path.basename(asset)
				};
			}
			const assetModule = await createAssetModule(asset.data, asset.name);
			const storageSize = p.assets.assetOverhead + Math.ceil((assetModule.length / (p.assets.blockSize - p.assets.assetPerBlockOverhead))) * p.assets.blockSize;
			totalSize += storageSize;

			processedAssets.push({
				moduleSize: assetModule.length,
				storageSize,
				name: asset.name,
				originalSize: asset.data.length
			});
		}
	}

	const details = {
		maxSingleAssetSize: p.assets.maxSingleAssetSize,
		maxTotalAssetSize: storageLimit,
		assets: processedAssets,
		totalAssetSize: totalSize,
		errors
	};

	for (let asset of processedAssets) {
		if (asset.moduleSize > p.assets.maxSingleAssetSize) {
			errors.push(new AssetLimitError(details, `Asset ${asset.name} exceeds maximum single asset size limit by ${asset.moduleSize - details.maxSingleAssetSize} bytes`));
		}
	}

	if (totalSize > storageLimit) {
		errors.push(new AssetLimitError(details, `Total size of assets exceeds platform limits by ${totalSize - storageLimit} bytes`));
	}

	if (errors.length > 0) {
		// Throw first one, additional can be accessed in err.details.errors
		throw errors[0];
	}

	return details;
}

/**
 * Create application and asset bundle
 *
 * @param {Buffer|string} application Application binary buffer/path
 * @param {Array.<object>|Array.<string>} assets Asset data or paths
 * @param {string} output output filename
 * @returns {Promise<Buffer>}
 */
async function createApplicationAndAssetBundle(application, assets) {
	let app = {};
	if (typeof application === 'string') {
		app.name = path.basename(application);
		app.data = await fsAsync.readFile(application);
	} else if (application.data && application.name) {
		app = application;
	} else {
		app = {
			data: application,
			name: 'application.bin'
		};
	}

	const processedAssets = [];
	if (assets) {
		for (let asset of assets) {
			if (typeof asset === 'string') {
				const data = await fsAsync.readFile(asset);
				asset = {
					data: data,
					name: path.basename(asset)
				};
			}
			processedAssets.push(asset);
		}
	}

	let updated;
	if (processedAssets.length > 0) {
		const details = await validateAssetLimits(app, processedAssets);
		try {
			updated = await updateModuleAssetDependencies(app.data, processedAssets);
		} catch (err) {
			if (err instanceof AssetLimitError) {
				err.details = details;
				err.details.errors.push(err);
				throw err;
			}
		}
	} else {
		updated = app.data;
	}

	return await tmp.withFile(async ({path, fd}) => {
		await new Promise((resolve, reject) => {
			const archive = archiver('zip', {
				zlib: { level: 9 }
			});
			const output = fs.createWriteStream(path);
			archive.append(updated, { name: app.name });
			for (let asset of processedAssets) {
				archive.append(asset.data, { name: `assets/${asset.name}` });
			}
			output.on('close', resolve);
			archive.on('error', reject);
			archive.pipe(output);
			archive.finalize();
		});
		return fsAsync.readFile(path);
	}, { discardDescriptor: true });
}

/**
 * Convert stream data into Buffer
 *
 * @param {Stream} s Module data.
 * @returns {Promise<object>}
 */
async function streamToBuffer(s) {
	const buffers = [];
	return new Promise((resolve, reject) => {
		s.on('data', (data) => {
			buffers.push(data);
		});
		s.on('end', () => {
			resolve(Buffer.concat(buffers));
		});
		s.on('error', (err) => {
			reject(err);
		});
	});
}

/**
 * Unpack application/asset zip bundle
 *
 * @param {Buffer} bundle Bundle data
 * @returns {Promise<Buffer>}
 */
async function unpackApplicationAndAssetBundle(bundle) {
	let stream = null;
	if (typeof bundle === 'string') {
		stream = fs.createReadStream(bundle);
	} else {
		stream = Readable.from(bundle);
	}

	stream = stream.pipe(unzip.Parse());

	return new Promise((resolve, reject) => {
		const result = {
			assets: []
		};
		stream.on('entry', async (entry) => {
			if (entry.type === 'File') {
				const data = await streamToBuffer(entry);
				if (path.dirname(entry.path) === 'assets') {
					result.assets.push({
						name: path.basename(entry.path),
						data: data
					});
				} else if (path.dirname(entry.path) === '.') {
					if (result.application) {
						throw new RangeError('More applications than expected in a bundle');
					}
					result.application = {
						name: entry.path,
						data: data
					};
				} else {
					entry.autodrain();
				}
			} else {
				entry.autodrain();
			}
		});
		stream.on('finish', () => resolve(result));
		stream.on('error', (error) => reject(error));
	});
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
	const prefixSize = prefix.prefixSize;
	if (prefixSize < MODULE_PREFIX_SIZE) {
		throw new RangeError('Invalid prefix size');
	}
	const minModuleSize = prefixSize + COMPRESSED_MODULE_HEADER_SIZE + suffixSize + 4;
	if (data.length < minModuleSize || data.length != dataSize) {
		throw new RangeError('Invalid size of the module data');
	}
	// Parse the header of the compressed data
	let offs = prefixSize;
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
	dataSize -= prefixSize;
	const decompData = await inflateRawAsync(data.slice(offs, offs + dataSize));
	if (decompData.length != decompDataSize) {
		throw new Error('Unexpected size of the decompressed data');
	}
	let destBuf = decompData;
	if (flags & ModuleFlags.DROP_MODULE_INFO) {
		// Restore the prefix and suffix data
		destBuf = Buffer.alloc(prefixSize + decompData.length + suffix.suffixSize + 4 /* CRC-32 */);
		data.copy(destBuf, 0, 0, prefixSize);
		decompData.copy(destBuf, prefixSize);
		updateModulePrefix(destBuf, {
			moduleEndAddy: startAddr + prefixSize + decompData.length + suffix.suffixSize, // CRC-32 is not part of the suffix
			moduleFlags: flags & ~ModuleFlags.COMPRESSED
		});
		updateModuleSuffix(destBuf, suffix);
		updateModuleSha256(destBuf);
		updateModuleCrc32(destBuf);
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

/**
 * Check if the hash of the provided asset binary matches the asset info stored in the application binary
 * @param {Buffer} asset - the bytes of the asset
 * @param {object} assetInfo - the asset info block from the assets array returned by parseBuffer
 * @returns {boolean} true if the asset matches the asset info, false otherwise. Throws if the asset
 */
function isAssetValid(asset, assetInfo) {
	if (assetInfo.hashType !== ModuleInfo.ModuleInfoHashExtensionType.SHA256) {
		throw new Error('Invalid asset hash type');
	}
	const assetHash = crypto.createHash('sha256');
	assetHash.update(asset);
	const assetHashHex = assetHash.digest('hex');

	return assetHashHex === assetInfo.hash;
};

/**
 * Add security mode extension to module with protected type.
 *
 * @param {Buffer} module Module data.
 * @param {Buffer} certificate Certificate (optional)
 * @returns {Promise<Buffer[]>}
 */
async function createProtectedModule(module, certificate) {
	const ext = {
		type: ModuleInfo.ModuleInfoExtension.SECURITY_MODE,
		securityMode: ModuleInfo.ModuleInfoSecurityMode.PROTECTED
	};
	if (certificate) {
		ext.certificate = certificate;
	}
	return addModuleExtensions({ module, exts: [ext], replaceWithSameType: true });
}

/**
 * Create an asset module containing a snapshot of environment variables.
 *
 * @param {Object} vars Variables snapshot.
 * @param {Object} vars.env Variable values. 
 * @param {String} vars.snapshot_hash Hex-encoded snapshot hash.
 * @param {String} vars.last_updated_at Snapshot creation time in the ISO format: `YYYY-MM-DDTHH:mm:ss.sssZ`.
 * @param {Object} [opts] Options.
 * @param {Buffer} [opts.assetHash] If provided, overrides the asset hash in the resulting module.
 * @returns {Promise<Buffer>} Module binary.
 */
async function createEnvVarsAsset(vars, { assetHash } = {}) {
	const maxAssetSize = 16 * 1024;

	// Validate the arguments
	if (!vars || typeof vars !== 'object') {
		throw new Error('Expected a snapshot object');
	}
	if (!vars.env || typeof vars.env !== 'object') {
		throw new Error('`env` is not an object');
	}
	let approxSize = 0;
	for (const [name, val] of Object.entries(vars.env)) {
		if (name.length > 128) {
			throw new Error(`Variable name is too long: ${name.slice(0, 30)}...`);
		}
		if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
			throw new Error(`Invalid variable name: ${name}`);
		}
		if (typeof val !== 'string') {
			throw new Error(`Variable value is not a string: ${name}`);
		}
		approxSize += name.length + val.length;
		if (approxSize > maxAssetSize) {
			throw new Error('Asset exceeds the maximum size');
		}
	}
	const snapshotHash = Buffer.from(vars.snapshot_hash, 'hex');
	if (snapshotHash.length !== 32) { // SHA-256
		throw new Error('`snapshot_hash` is not a valid hash');
	}
	const updatedAt = Date.parse(vars.last_updated_at);
	if (Number.isNaN(updatedAt)) {
		throw new Error('`last_updated_at` is not a valid timestamp');
	}

	const EnvVars = pb.system.EnvVars;
	const assetData = EnvVars.encode(EnvVars.create({
		vars: Object.entries(vars.env).map(([name, value]) => EnvVars.Var.create({ name, value })),
		hash: snapshotHash,
		updatedAt
	}));

	const assetModule = await createAssetModule(assetData, 'env-vars', {
		compress: false,
		hash: assetHash // Optional
	});
	if (assetModule.length > maxAssetSize) {
		throw new Error('Asset exceeds the maximum size');
	}
	return assetModule;
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
	createAssetModule,
	updateModuleAssetDependencies,
	unwrapAssetModule,
	createApplicationAndAssetBundle,
	unpackApplicationAndAssetBundle,
	sanitizeAddress,
	isAssetValid,
	validateAssetLimits,
	AssetLimitError,
	PlatformLimitError,
	createProtectedModule,
	addModuleExtensions,
	removeModuleExtensions,
	listModuleExtensions,
	createEnvVarsAsset
};
