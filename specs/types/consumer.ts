import {
	HalModuleParser,
	HalDescribeParser,
	HalDependencyResolver,
	FirmwareModule,
	ModuleInfo,
	firmwareTestHelper,
	createAssetModule,
	updateModulePrefix,
	validateAssetLimits,
	AssetLimitError,
	config,
	type PrefixInput,
	type AssetLimitDetails,
	type Config
} from 'binary-version-reader';
import { HalModuleParser as LimitedHalModuleParser, ModuleInfo as LimitedModuleInfo } from 'binary-version-reader/limited';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function assertType<T extends true>(): T | void {}

export async function parsing(fileBuffer: Buffer): Promise<void> {
	const parser = new HalModuleParser();
	const fileInfo = await parser.parseBuffer({ fileBuffer });
	assertType<Equal<typeof fileInfo, HalModuleParser.FileInfo>>();
	assertType<Equal<typeof fileInfo.prefixInfo.depModuleFunction, number>>();
	assertType<Equal<typeof fileInfo.prefixInfo.platformID, number>>();
	assertType<Equal<typeof fileInfo.prefixInfo.depModuleVersion, number>>();
	assertType<Equal<typeof fileInfo.prefixInfo.moduleStartAddy, string>>();
	assertType<Equal<typeof fileInfo.suffixInfo.productId, number>>();
	assertType<Equal<typeof fileInfo.suffixInfo.fwUniqueId, string>>();
	assertType<Equal<typeof fileInfo.crc.ok, boolean>>();
	assertType<Equal<typeof fileInfo.assets, HalModuleParser.AssetInfo[] | undefined>>();
	const extension: HalModuleParser.ModuleExtension | undefined = fileInfo.suffixInfo.extensions?.[0];
	void extension;

	if (fileInfo.prefixInfo.depModuleFunction === ModuleInfo.FunctionType.SYSTEM_PART) {
		const prefix: HalModuleParser.PrefixInfo = fileInfo.prefixInfo;
		void prefix;
	}

	// @ts-expect-error fileBuffer is required
	await parser.parseBuffer({});

	const parsed = await parser.parseFile('firmware.bin', (info, error) => {
		assertType<Equal<typeof info, HalModuleParser.FileInfo | null>>();
		void error;
	});
	void parsed.filename;

	const prefixOnly = await new LimitedHalModuleParser().parsePrefix({ fileBuffer });
	assertType<Equal<typeof prefixOnly.prefixInfo, HalModuleParser.PrefixInfo>>();
}

export function moduleInfo(): void {
	assertType<Equal<typeof ModuleInfo.FunctionType.SYSTEM_PART, 4>>();
	assertType<Equal<typeof ModuleInfo.FunctionType.USER_PART, 5>>();
	assertType<Equal<typeof ModuleInfo.FunctionChar.SYSTEM_PART, 's'>>();
	assertType<Equal<typeof ModuleInfo.ValidationFlags.INTEGRITY, 2>>();
	assertType<Equal<typeof ModuleInfo.ExtensionType.ASSET_DEPENDENCY, 18>>();
	assertType<Equal<typeof ModuleInfo.MODULE_PREFIX_SIZE, 24>>();
	assertType<Equal<typeof ModuleInfo.Platform, Record<string, number>>>();
	assertType<Equal<typeof LimitedModuleInfo.FunctionType.BOOTLOADER, 2>>();
	// @ts-expect-error constants are read-only
	ModuleInfo.FunctionType.SYSTEM_PART = 5;
}

export function describeParser(describe: HalDescribeParser.Describe): number | null | undefined {
	const describeParser = new HalDescribeParser();
	const modules = describeParser.getModules(describe);
	assertType<Equal<typeof modules, FirmwareModule[] | null>>();
	return describeParser.getSystemVersion(describe);
}

export function firmwareModule(): FirmwareModule {
	const firmwareModule = new FirmwareModule();
	firmwareModule.func = 's';
	firmwareModule.version = 1;
	firmwareModule.name = '1';
	const dependency = new FirmwareModule({ f: 's', n: '2', v: 3 });
	firmwareModule.dependencies.push(dependency);
	const describe: FirmwareModule.DescribeModule = firmwareModule.toDescribe();
	assertType<Equal<typeof firmwareModule.isSystemModule, () => boolean>>();
	void describe;

	const resolver = new HalDependencyResolver();
	const missing: FirmwareModule.DescribeModule[] = resolver.solveFirmwareModule([describe], dependency);
	void missing;
	return firmwareModule;
}

export async function encoding(): Promise<void> {
	const binary: Buffer = firmwareTestHelper.createFirmwareBinary({ productId: 1, productVersion: 2, platformId: 32, dataSize: 16 });
	firmwareTestHelper.createFirmwareBinary();
	firmwareTestHelper.createFirmwareBinary({ deps: [{ func: ModuleInfo.FunctionType.SYSTEM_PART, index: 1, version: 3000 }] });
	// @ts-expect-error unknown option
	firmwareTestHelper.createFirmwareBinary({ product: 1 });

	const prefix: PrefixInput = { moduleStartAddy: 0x1000, moduleEndAddy: 'ffff' };
	updateModulePrefix(binary, prefix);
	const asset: Buffer = await createAssetModule(Buffer.from('asset'), 'asset.txt', { zlib: { level: 9 } });
	void asset;

	try {
		const details: AssetLimitDetails = await validateAssetLimits(binary, ['asset.txt', { name: 'a', data: asset }]);
		void details.assets[0]?.storageSize;
	} catch (error) {
		if (error instanceof AssetLimitError) {
			void error.details.errors;
		}
	}

	const current: Config = config({ crc32: (data) => data.subarray(0, 4) });
	void current;
}
