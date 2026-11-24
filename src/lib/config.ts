import defaultCrc32 from 'buffer-crc32';

export interface Config {
	/** Function to use for CRC-32 computations. Returns the 4-byte checksum. */
	crc32: (data: Buffer) => Buffer;
}

export const globalConfig: Config = {
	crc32: defaultCrc32
};

/**
 * Set global configuration.
 *
 * @returns The current configuration
 */
export function config(options?: Partial<Config>): Config {
	return Object.assign(globalConfig, options);
}
