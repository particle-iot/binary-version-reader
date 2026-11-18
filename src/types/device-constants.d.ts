declare module '@particle/device-constants' {
	export interface FirmwareModuleInfo {
		type: string;
		index?: number;
		storage?: string;
		maxSize?: number;
		growsLeft?: boolean;
	}

	export interface PlatformAssets {
		blockSize: number;
		storageTotalBlocks: number;
		maxSingleAssetSize: number;
		assetPerBlockOverhead: number;
		assetOverhead: number;
		reservedBlocks: number;
	}

	export interface Platform {
		id: number;
		name: string;
		generation: number;
		firmwareModules?: FirmwareModuleInfo[];
		assets?: PlatformAssets;
	}

	export const platforms: Record<string, Platform>;
	export const platformsById: Record<number, Platform | undefined>;
}
