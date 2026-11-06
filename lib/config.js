const defaultCrc32 = require('buffer-crc32');

/**
 * @typedef {object} Config
 * @property {(data: Buffer) => Buffer} crc32 Function to use for CRC-32 computations. Returns the 4-byte checksum.
 */

/** @type {Config} */
const globalConfig = {
	crc32: defaultCrc32
};

/**
 * Set global configuration.
 *
 * @param {Partial<Config>} [options] Options.
 * @returns {Config} Current configuration.
 */
function config(options) {
	return Object.assign(globalConfig, options);
}

module.exports = {
	globalConfig,
	config
};
