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
const { platforms } = require('@particle/device-constants');

const ModuleFunction = {
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
};

const ModuleFunctionChar = {
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
};

const ModuleFunctionToChar = [
    ModuleFunctionChar.NONE,
    ModuleFunctionChar.RESOURCE,
    ModuleFunctionChar.BOOTLOADER,
    ModuleFunctionChar.MONO_FIRMWARE,
    ModuleFunctionChar.SYSTEM_PART,
    ModuleFunctionChar.USER_PART,
    ModuleFunctionChar.SETTINGS,
    ModuleFunctionChar.NCP_FIRMWARE,
    ModuleFunctionChar.RADIO_STACK,
    ModuleFunctionChar.ASSET
];

const ModuleInfoFlags = {
    NONE: 0x0,
    DROP_MODULE_INFO: 0x01,
    COMPRESSED: 0x02,
    COMBINED: 0x04,
    ENCRYPTED: 0x08,
    PREFIX_EXTENSIONS: 0x10
};

const ModuleValidationFlags = {
    PASSED: 0,
    INTEGRITY: (1 << 1),
    DEPENDENCIES: (1 << 2),
    RANGE: (1 << 3),
    PLATFORM: (1 << 4),
    PRODUCT: (1 << 5),
    DEPENDENCIES_FULL: (1 << 6)
};

const ModuleInfoExtension = {
    END: 0x0000,
    PRODUCT_DATA: 0x0001,
    DYNAMIC_LOCATION: 0x0002,
    DEPENDENCY: 0x0003,
    HASH: 0x0010,
    NAME: 0x0011,
    ASSET_DEPENDENCY: 0x0012,
    SECURITY_MODE: 0x0013,
    INVALID: 0xffff
};

const ModuleInfoHashExtensionType = {
    SHA256: 0
};

const ModuleInfoSecurityMode = {
    NONE: 0,
    PROTECTED: 1
};

const ModuleInfoPlatform = Object.values(platforms)
    .filter(p => p.generation > 0)
    .reduce((out, p) => {
        out[p.name.toUpperCase()] = p.id;
        return out;
    }, {});


// TODO (mirande): legacy name, remove for v2
ModuleInfoPlatform.ASSETTRACKER = 26

/**
 * The size of a module's prefix data.
 *
 * This is the size of the `module_info_t` structure in Device OS.
 */
const MODULE_PREFIX_SIZE = 24;

/**
 * The minimum size of a module's suffix data.
 *
 * This is the size of the `module_info_suffix_t` structure in Device OS.
 */
const MIN_MODULE_SUFFIX_SIZE = 36;

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
const MAX_MODULE_SUFFIX_SIZE = 0xffff;

// For backward compatibility
const HEADER_SIZE = MODULE_PREFIX_SIZE;

module.exports = {
    FunctionType: ModuleFunction,
    FunctionChar: ModuleFunctionChar,
    Flags: ModuleInfoFlags,
    FunctionToChar: ModuleFunctionToChar,
    ValidationFlags: ModuleValidationFlags,
    Platform: ModuleInfoPlatform,
    MODULE_PREFIX_SIZE,
    MIN_MODULE_SUFFIX_SIZE,
    MAX_MODULE_SUFFIX_SIZE,
    HEADER_SIZE: HEADER_SIZE,
    ModuleInfoExtension,
    ModuleInfoHashExtensionType,
    ModuleInfoSecurityMode
};
