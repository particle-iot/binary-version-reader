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

const ModuleFunction = {
    NONE: 0,
    RESOURCE: 1,
    BOOTLOADER: 2,
    MONO_FIRMWARE: 3,
    SYSTEM_PART: 4,
    USER_PART: 5,
    SETTINGS: 6,
    NCP_FIRMWARE: 7,
    RADIO_STACK: 8
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
    RADIO_STACK: 'a'
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
    ModuleFunctionChar.RADIO_STACK
];

const ModuleInfoFlags = {
    NONE: 0x0,
    DROP_MODULE_INFO: 0x01,
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

const ModuleInfoPlatform = {
    CORE: 0,
    PHOTON: 6,
    P1: 8,
    ELECTRON: 10,
    ARGON: 12,
    BORON: 13,
    XENON: 14,
    ASOM: 22,
    BSOM: 23,
    XSOM: 24,
    B5SOM: 25,
    ASSETTRACKER: 26
};

const HEADER_SIZE = 24;

module.exports = {
    FunctionType: ModuleFunction,
    FunctionChar: ModuleFunctionChar,
    Flags: ModuleInfoFlags,
    FunctionToChar: ModuleFunctionToChar,
    ValidationFlags: ModuleValidationFlags,
    Platform: ModuleInfoPlatform,
    HEADER_SIZE: HEADER_SIZE
};
