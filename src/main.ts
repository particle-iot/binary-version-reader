/*
 *  Copyright 2015 Particle ( https://particle.io )
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/**
 * Created by middleca on 6/11/15.
 */

export {
	HalModuleParser,
	type AssetInfo,
	type CrcInfo,
	type FileBufferInfo,
	type FileInfo,
	type ModuleExtension,
	type ParseCallback,
	type ParsedFileFields,
	type PrefixInfo,
	type SecurityInfo,
	type SuffixInfo
} from './lib/HalModuleParser';
export { HalDescribeParser, type Describe } from './lib/HalDescribeParser';
export {
	HalDependencyResolver,
	type AssimilatedModule,
	type BinaryModule,
	type ModuleRequirement
} from './lib/HalDependencyResolver';
export { FirmwareModule, type DescribeModule } from './lib/FirmwareModule';
export * as ModuleInfo from './lib/ModuleInfo';
export * as firmwareTestHelper from './lib/firmwareTestHelper';
export type { CreateFirmwareBinaryOptions, DescribeFixture, FirmwareDependency } from './lib/firmwareTestHelper';
export {
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
	encodeEnvVarsAsset,
	createEnvVarsAssetModule,
	ENV_ASSET_NAME,
	ENV_JSON_FILE,
	MAX_ENV_SIZE,
	type ModuleExtensionInput,
	type PrefixInput,
	type SuffixInput,
	type NamedData,
	type AssetDependencyInput,
	type ProcessedAsset,
	type AssetLimitDetails,
	type UnpackedBundle,
	type EnvVarsSnapshot,
	type ChecksumOptions,
	type CompressOptions,
	type AssetModuleOptions
} from './lib/moduleEncoding';
export { globalConfig, config, type Config } from './lib/config';
