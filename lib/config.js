const defaultCrc32 = require('buffer-crc32');

const globalConfig = {
	crc32: defaultCrc32
};

/**
 * Set global configuration.
 *
 * @param {Object} [options] Options.
 * @param {Function} [options.crc32] Function to use for CRC-32 computations.
 * @returns {Object} Current configuration.
 */
function config(options) {
	return Object.assign(globalConfig, options);
}

module.exports = {
	globalConfig,
	config
};
