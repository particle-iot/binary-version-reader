/*
 *  Copyright 2019 Particle ( https://particle.io )
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
import { platforms } from '@particle/device-constants';

const extensionType = {
	END: 0x0000,
	PRODUCT_DATA: 0x0001,
	DYNAMIC_LOCATION: 0x0002,
	DEPENDENCY: 0x0003,
	HASH: 0x0010,
	NAME: 0x0011,
	ASSET_DEPENDENCY: 0x0012,
	SECURITY_MODE: 0x0013,
	ASSET_TYPE: 0x0014,
	INVALID: 0xffff
} as const;

export const FunctionType = {
	NONE: 0,
	RESOURCE: 1,
	BOOTLOADER: 2,
	MONO_FIRMWARE: 3,
	SYSTEM_PART: 4,
	USER_PART: 5,
	SETTINGS: 6,
	NCP_FIRMWARE: 7,
	RADIO_STACK: 8,
	ASSET: 9
} as const;

export const FunctionChar = {
	NONE: 'n',
	RESOURCE: 'r',
	BOOTLOADER: 'b',
	MONO_FIRMWARE: 'm',
	SYSTEM_PART: 's',
	USER_PART: 'u',
	SETTINGS: '_', // unused
	NCP_FIRMWARE: 'c',
	RADIO_STACK: 'a',
	ASSET: 't'
} as const;

export const Flags = {
	NONE: 0x0,
	DROP_MODULE_INFO: 0x01,
	COMPRESSED: 0x02,
	COMBINED: 0x04,
	ENCRYPTED: 0x08,
	PREFIX_EXTENSIONS: 0x10
} as const;

export const FunctionToChar = [
	FunctionChar.NONE,
	FunctionChar.RESOURCE,
	FunctionChar.BOOTLOADER,
	FunctionChar.MONO_FIRMWARE,
	FunctionChar.SYSTEM_PART,
	FunctionChar.USER_PART,
	FunctionChar.SETTINGS,
	FunctionChar.NCP_FIRMWARE,
	FunctionChar.RADIO_STACK,
	FunctionChar.ASSET
] as const;

export const ValidationFlags = {
	PASSED: 0,
	INTEGRITY: 0x02,
	DEPENDENCIES: 0x04,
	RANGE: 0x08,
	PLATFORM: 0x10,
	PRODUCT: 0x20,
	DEPENDENCIES_FULL: 0x40
} as const;

/** Platform IDs by upper-case platform name, e.g. `Platform.P2` */
export const Platform: Record<string, number> = Object.fromEntries(
	Object.values(platforms)
		.filter((p) => p.generation > 0)
		.map((p) => [p.name.toUpperCase(), p.id])
);

/**
 * The size of a module's prefix data.
 *
 * This is the size of the `module_info_t` structure in Device OS.
 */
export const MODULE_PREFIX_SIZE = 24;

/**
 * The minimum size of a module's suffix data.
 *
 * This is the size of the `module_info_suffix_t` structure in Device OS.
 */
export const MIN_MODULE_SUFFIX_SIZE = 36;

/**
 * The maximum size of a module's suffix data.
 *
 * This is the size of the `module_info_suffix_t` structure in Device OS plus the size of the
 * following fields:
 *
 * - Product ID (4 bytes);
 * - Product version (2 bytes).
 *
 * The value of this constant needs to be updated whenever a new field is added to the suffix layout.
 *
 * NOTE: some platforms now have dynamic extensions in the module suffix, 65535 is absolute maximum limit
 * of the uint16_t size field in the suffix.
 */
export const MAX_MODULE_SUFFIX_SIZE = 0xffff;

/** @deprecated Use `MODULE_PREFIX_SIZE` */
export const HEADER_SIZE = MODULE_PREFIX_SIZE;

/** @deprecated Use `ExtensionType` */
export const ModuleInfoExtension = extensionType;
export const ExtensionType = extensionType;

export const ModuleInfoHashExtensionType = {
	SHA256: 0
} as const;

export const ModuleInfoSecurityMode = {
	NONE: 0,
	PROTECTED: 1
} as const;

export const AssetType = {
	DEFAULT: 0,
	ENV_VARS_APP: 1,
	ENV_VARS_SNAPSHOT: 2
} as const;
