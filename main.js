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

const HalModuleParser = require('./lib/HalModuleParser.js');
const HalDescribeParser = require('./lib/HalDescribeParser.js');
const HalDependencyResolver = require('./lib/HalDependencyResolver.js');
const FirmwareModule = require('./lib/FirmwareModule.js');
const ModuleInfo = require('./lib/ModuleInfo.js');
const firmwareTestHelper = require('./lib/firmwareTestHelper');
const {
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
	MAX_ENV_SIZE
} = require('./lib/moduleEncoding');
const { globalConfig, config } = require('./lib/config');

/**
 * @typedef {import('./lib/moduleEncoding').ModuleExtensionInput} ModuleExtensionInput
 * @typedef {import('./lib/moduleEncoding').PrefixInput} PrefixInput
 * @typedef {import('./lib/moduleEncoding').SuffixInput} SuffixInput
 * @typedef {import('./lib/moduleEncoding').NamedData} NamedData
 * @typedef {import('./lib/moduleEncoding').AssetDependencyInput} AssetDependencyInput
 * @typedef {import('./lib/moduleEncoding').ProcessedAsset} ProcessedAsset
 * @typedef {import('./lib/moduleEncoding').AssetLimitDetails} AssetLimitDetails
 * @typedef {import('./lib/moduleEncoding').UnpackedBundle} UnpackedBundle
 * @typedef {import('./lib/moduleEncoding').EnvVarsSnapshot} EnvVarsSnapshot
 * @typedef {import('./lib/config').Config} Config
 */

module.exports = {
	HalModuleParser,
	HalDescribeParser,
	HalDependencyResolver,
	FirmwareModule,
	ModuleInfo,
	firmwareTestHelper,
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
	globalConfig,
	config
};
