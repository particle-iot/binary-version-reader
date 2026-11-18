import { randomFillSync } from 'crypto';

import describe042Data from './describeFixtures/042_describe';
import describeData from './describeFixtures/describe';
import describeNoUsermoduleData from './describeFixtures/describe_no_usermodule';
import describeNoUsermodule2Data from './describeFixtures/describe_no_usermodule2';
import describeOneSystemmoduleData from './describeFixtures/describe_one_systemmodule';
import fixedDependenciesDescribeData from './describeFixtures/fixed_dependencies_describe';
import fixedDescribeData from './describeFixtures/fixed_describe';
import multipleDependenciesData from './describeFixtures/multiple_dependencies';
import oldDescribeData from './describeFixtures/old_describe';
import safeMode1Data from './describeFixtures/safe_mode_1';
import safeMode2Data from './describeFixtures/safe_mode_2';
import safeMode3Data from './describeFixtures/safe_mode_3';
import threeSystemModulesData from './describeFixtures/three_system_modules';
import threeSystemModulesWithFirmwareResetData from './describeFixtures/three_system_modules_with_firmware_reset';
import type { DescribeModule } from './FirmwareModule';
import type { Describe } from './HalDescribeParser';
import { updateModulePrefix, updateModuleSuffix, updateModuleSha256, updateModuleCrc32 } from './moduleEncoding';
import * as ModuleInfo from './ModuleInfo';

export interface FirmwareDependency {
	/** One of `ModuleInfo.FunctionType` */
	func: number;
	index: number;
	version: number;
}

/**
 * Options for `createFirmwareBinary()`. The product ID, product version and platform ID are left as `0xffff` when
 * not given.
 */
export interface CreateFirmwareBinaryOptions {
	productId?: number;
	productVersion?: number;
	platformId?: number;
	/** One of `ModuleInfo.FunctionType`, defaults to `USER_PART` */
	moduleFunction?: number;
	moduleIndex?: number;
	moduleVersion?: number;
	/** Up to two dependencies */
	deps?: FirmwareDependency[];
	/** Put `vectorTableSize` bytes before the module prefix */
	addVectorTable?: boolean;
	vectorTableSize?: number;
	moduleStartAddress?: number;
	/** Size in bytes of the module data between the prefix and the suffix */
	dataSize?: number;
}

/**
 * Creates a valid firmware binary for usage in tests. Half of the module data is random.
 */
export function createFirmwareBinary({
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
}: CreateFirmwareBinaryOptions = {}): Buffer {
	const prefixOffset = addVectorTable ? vectorTableSize : 0;
	const binary = Buffer.alloc(
		ModuleInfo.MODULE_PREFIX_SIZE +
			prefixOffset +
			dataSize +
			ModuleInfo.MIN_MODULE_SUFFIX_SIZE +
			2 /* Product ID */ +
			2 /* Product version */ +
			4 /* CRC-32 */,
		0xff
	);
	// Part of the module data is filled with 0xff so that the module is compressible
	randomFillSync(binary, ModuleInfo.MODULE_PREFIX_SIZE + prefixOffset, Math.floor(dataSize / 2));

	const [dep1, dep2] = deps;
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
		depModuleFunction: dep1 ? dep1.func : ModuleInfo.FunctionType.NONE,
		depModuleIndex: dep1 ? dep1.index : 0,
		depModuleVersion: dep1 ? dep1.version : 0,
		dep2ModuleFunction: dep2 ? dep2.func : ModuleInfo.FunctionType.NONE,
		dep2ModuleIndex: dep2 ? dep2.index : 0,
		dep2ModuleVersion: dep2 ? dep2.version : 0
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

/** A describe message captured from a device. Fields other than the module list are passed through as-is. */
export interface DescribeFixture extends Describe {
	m: DescribeModule[];
	/** Platform ID */
	p?: number;
	[key: string]: unknown;
}

function fixture(data: DescribeFixture): () => DescribeFixture {
	return () => structuredClone(data);
}

/**
 * Describe messages captured from devices, for tests. Each function returns a fresh copy, so tests can modify it.
 */
export const describeFixtures = {
	describe042: fixture(describe042Data),
	describe: fixture(describeData),
	describeNoUsermodule: fixture(describeNoUsermoduleData),
	describeNoUsermodule2: fixture(describeNoUsermodule2Data),
	describeOneSystemmodule: fixture(describeOneSystemmoduleData),
	fixedDependenciesDescribe: fixture(fixedDependenciesDescribeData),
	fixedDescribe: fixture(fixedDescribeData),
	multipleDependencies: fixture(multipleDependenciesData),
	oldDescribe: fixture(oldDescribeData),
	safeMode1: fixture(safeMode1Data),
	safeMode2: fixture(safeMode2Data),
	safeMode3: fixture(safeMode3Data),
	threeSystemModules: fixture(threeSystemModulesData),
	threeSystemModulesWithFirmwareReset: fixture(threeSystemModulesWithFirmwareResetData)
};
