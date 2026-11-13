import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
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

const fs = require('fs');
const path = require('path');

const HalModuleParser = require('../../lib/HalModuleParser.js');
const ModuleInfo = require('../../lib/ModuleInfo.js');
const createFirmwareBinary = require('../../lib/firmwareTestHelper').createFirmwareBinary;
const config = require('../../lib/config.js').config;

const settings = {
	binaries: path.resolve(path.join(__dirname, '../binaries'))
};


describe('HalModuleParser', function () {
	it('should fail gracefully when the file doesn\'t exist or is empty', async function () {
		const filename = path.join(settings.binaries, 'emptybin.bin');
		const parser = new HalModuleParser();
		try {
			await parser._loadFile(filename);
			throw new Error('should have failed');
		} catch (err) {}
	});

	it('should succeed when the file exists', async function () {
		const filename = path.join(settings.binaries, '040_system-part1.bin');
		const parser = new HalModuleParser();
		return parser._loadFile(filename);
	});


	it('should validate the CRC in the binary', async function () {
		const filename = path.join(settings.binaries, '040_system-part1.bin');
		const parser = new HalModuleParser();

		const buffer = await parser._loadFile(filename);
		const crcInfo = await parser._validateCRC(buffer);
		expect(crcInfo).be.ok;
		expect(crcInfo.ok).be.ok;
		expect(crcInfo.actualCrc).be.ok;
		expect(crcInfo.storedCrc).eql(crcInfo.actualCrc);
	});

	it('should read prefix info from part 1', async function () {
		const filename = path.join(settings.binaries, '040_system-part1.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '8020000',
			moduleEndAddy: '805cba4',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 1,
			platformID: 6,
			moduleFunction: 4,
			moduleIndex: 1,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 388,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read prefix info from part 2', async function () {
		const filename = path.join(settings.binaries, '040_system-part2.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '8060000',
			moduleEndAddy: '807e954',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 1,
			platformID: 6,
			moduleFunction: 4,
			moduleIndex: 2,
			depModuleFunction: 4,
			depModuleIndex: 1,
			depModuleVersion: 1,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 388,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read prefix info from a user module', async function () {
		const filename = path.join(settings.binaries, '040_user-part.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '80a0000',
			moduleEndAddy: '80a128c',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 2,
			platformID: 6,
			moduleFunction: 5,
			moduleIndex: 1,
			depModuleFunction: 4,
			depModuleIndex: 2,
			depModuleVersion: 1,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 0,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read prefix info from monolithic firmware', async function () {
		const filename = path.join(settings.binaries, '044_Core_Tinker_P5_V10.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '8005000',
			moduleEndAddy: '801a8e0',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 0,
			platformID: 0,
			moduleFunction: 3,
			moduleIndex: 0,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 268,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read suffix info from system part 1', async function () {
		const filename = path.join(settings.binaries, '040_system-part1.bin');
		const expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ecb6acb4cf75ca04169f2214a24c470516cabe91683ac3664bdd174c4bb50386',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '5d7db471'
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});

	it('should read suffix info from system part 2', async function () {
		const filename = path.join(settings.binaries, '040_system-part2.bin');
		const expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ea3d9d175a6eee3d10023316240b51bea8200bdc182d0343801161b7ca53e2ae',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '7db66023'
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});


	it('should read suffix info from the user part', async function () {
		const filename = path.join(settings.binaries, '040_user-part.bin');
		const expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'f9f552aa98d7e3eab750862a01743024a4d05514021598a4341b3d83b37eda36',
			reserved: 0,
			suffixSize: 36,
			crcBlock: 'b138f375'
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});


	it('should read info from a bootloader module', async function () {
		const filename = path.join(settings.binaries, 'RC4_bootloader_pad_BM-09.bin');

		const expectedPrefixInfo = {
			moduleStartAddy: '8000000',
			moduleEndAddy: '8003f98',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 2,
			platformID: 6,
			moduleFunction: 2,
			moduleIndex: 0,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 388,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const expectedSuffixInfo = {
			productId: 65535,
			productVersion: 65535,
			fwUniqueId: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
			reserved: 65535,
			suffixSize: 65535,
			crcBlock: 'ffffffff'
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.suffixInfo).eql(expectedSuffixInfo);
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should have a working example', async function () {
		const filename = path.join(settings.binaries, '040_user-part.bin');
		const Reader = require('../../main.js').HalModuleParser;
		const reader = new Reader();
		const fileInfo = await reader.parseFile(filename);
		expect(fileInfo).be.ok;
	});

	it('should work with bluz system-part', async function () {
		const filename = path.join(settings.binaries, '103_system-part1.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '18000',
			moduleEndAddy: '36768',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 1,
			platformID: 103,
			moduleFunction: 4,
			moduleIndex: 1,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 192,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with xenon system part', async function () {
		const filename = path.join(settings.binaries, '080_system-part1-xenon.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '30000',
			moduleEndAddy: 'c7580',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 312,
			platformID: 14,
			moduleFunction: 4,
			moduleIndex: 1,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 2,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 101,
			prefixOffset: 512,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with xenon user part', async function () {
		const filename = path.join(settings.binaries, '080_user-part-xenon.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: 'd4000',
			moduleEndAddy: 'd4cec',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 5,
			platformID: 14,
			moduleFunction: 5,
			moduleIndex: 1,
			depModuleFunction: 4,
			depModuleIndex: 1,
			depModuleVersion: 312,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 0,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with xenon bootloader', async function () {
		const filename = path.join(settings.binaries, '080_bootloader-xenon.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: 'f4000',
			moduleEndAddy: 'fc164',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 211,
			platformID: 14,
			moduleFunction: 2,
			moduleIndex: 0,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 512,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with argon ncp', async function () {
		const filename = path.join(settings.binaries, 'argon-ncp-firmware-0.0.5-ota.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '0',
			moduleEndAddy: 'ca73c',
			reserved: 33,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 5,
			platformID: 12,
			moduleFunction: 7,
			moduleIndex: 0,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 0,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with boron-som system part', async function () {
		const filename = path.join(settings.binaries, 'boron-som-system-part1@1.1.0-rc.1.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '30000',
			moduleEndAddy: 'ce668',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 1100,
			platformID: 23,
			moduleFunction: 4,
			moduleIndex: 1,
			depModuleFunction: 2,
			depModuleIndex: 0,
			depModuleVersion: 201,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 512,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with argon softdevice (radio stack)', async function () {
		const filename = path.join(settings.binaries, 'argon-softdevice-6.1.1.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '1000',
			moduleEndAddy: '25e24',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.DROP_MODULE_INFO,
			moduleVersion: 182,
			platformID: ModuleInfo.Platform.ARGON,
			moduleFunction: ModuleInfo.FunctionType.RADIO_STACK,
			moduleIndex: 0,
			depModuleFunction: ModuleInfo.FunctionType.SYSTEM_PART,
			depModuleIndex: 1,
			depModuleVersion: 1300,
			dep2ModuleFunction: ModuleInfo.FunctionType.BOOTLOADER,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 311,
			prefixOffset: 0,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	describe('given a module descriptor', function () {
		/**
		 * @param {object} module Prefix fields to encode
		 * @returns {Buffer} A 24-byte module prefix
		 */
		function buildModule(module) {
			const buffer = Buffer.alloc(24);
			let offset = 0;
			offset = buffer.writeUInt32LE(module.moduleStartAddy, offset);
			offset = buffer.writeUInt32LE(module.moduleEndAddy, offset);
			offset = buffer.writeUInt16LE(0, offset);       // reserved
			offset = buffer.writeUInt16LE(module.moduleVersion, offset);
			offset = buffer.writeUInt16LE(module.platformID, offset);
			offset = buffer.writeUInt8(module.moduleFunction, offset);
			offset = buffer.writeUInt8(module.moduleIndex, offset);
			offset = writeModuleDependency(buffer, offset, module.depModuleFunction, module.depModuleIndex, module.depModuleVersion);
			writeModuleDependency(buffer, offset, module.dep2ModuleFunction, module.dep2ModuleIndex, module.dep2ModuleVersion);
			return buffer;
		}

		/**
		 * @param {Buffer} buffer
		 * @param {number} offset
		 * @param {number} f Module function
		 * @param {number} n Module index
		 * @param {number} v Module version
		 * @returns {number} The offset after the dependency
		 */
		function writeModuleDependency(buffer, offset, f, n, v) {
			offset = buffer.writeUInt8(f, offset);
			offset = buffer.writeUInt8(n, offset);
			return buffer.writeUInt16LE(v, offset);
		}

		let buffer;

		const testModule1 = {
			moduleStartAddy: 0x12345678,
			moduleEndAddy: 0x87654321,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 1234,
			platformID: 4567,
			moduleFunction: 147,
			moduleIndex: 139,
			depModuleFunction: 250,
			depModuleIndex: 251,
			depModuleVersion: 345,
			dep2ModuleFunction: 252,
			dep2ModuleIndex: 252,
			dep2ModuleVersion: 3456

		};

		beforeEach(function () {
			buffer = buildModule(testModule1);
		});

		describe('when the buffer is parsed', function () {
			let module;
			beforeEach(function () {
				const parser = new HalModuleParser();
				const buf = Buffer.alloc(buffer.length);
				buffer.copy(buf);
				parser._findModulePrefixOffset = function () {
					return 0;
				};
				module = parser._readPrefix(buffer);
			});

			it('parses the module version as 16-bits LE', function () {
				expect(module).have.property('depModuleVersion').eql(345);
			});

			it('parses the 2nd module version as 16-bits LE', function () {
				expect(module).have.property('dep2ModuleVersion').eql(3456);
			});

		});

	});

	it('allows parsing prefix and suffix info separately', function () {
		const file = path.join(settings.binaries, '040_system-part1.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '8020000',
			moduleEndAddy: '805cba4',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.NONE,
			moduleVersion: 1,
			platformID: 6,
			moduleFunction: 4,
			moduleIndex: 1,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixOffset: 388,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};
		const expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ecb6acb4cf75ca04169f2214a24c470516cabe91683ac3664bdd174c4bb50386',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '5d7db471'
		};
		const fileBuffer = fs.readFileSync(file);
		const parser = new HalModuleParser();
		return parser.parsePrefix({ fileBuffer: fileBuffer })
			.then(function (fileInfo) {
				expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
				expect(fileInfo).not.have.property('suffixInfo');
				return parser.parseSuffix({ fileBuffer: fileBuffer });
			})
			.then(function (fileInfo) {
				expect(fileInfo.suffixInfo).eql(expectedSuffixInfo);
				expect(fileInfo).not.have.property('prefixInfo');
			})
	});

	describe('given that a custom CRC-32 function is provided globally', function () {
		let defaultCrc32 = null;

		beforeAll(function () {
			defaultCrc32 = config().crc32;
		});

		afterEach(function () {
			config({ crc32: defaultCrc32 });
		});

		it('uses that function for CRC-32 computations', function () {
			const dummyCrc = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
			config({
				crc32: function (buf) {
					return dummyCrc;
				}
			});
			const parser = new HalModuleParser();
			return parser.parseBuffer({ fileBuffer: createFirmwareBinary() })
				.then(function (fileInfo) {
					expect(fileInfo.crc.actualCrc).eql(dummyCrc.toString('hex'));
				});
		});
	});

	it('should work with unknown valid module', async function () {
		const filename = path.join(settings.binaries, 'unknown.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '20003000',
			moduleEndAddy: '2000503c',
			reserved: 129,
			moduleFlags: 128,
			moduleVersion: 9999,
			platformID: 129,
			moduleFunction: 129,
			moduleIndex: 99,
			depModuleFunction: 129,
			depModuleIndex: 99,
			depModuleVersion: 999,
			dep2ModuleFunction: 129,
			dep2ModuleIndex: 29,
			dep2ModuleVersion: 129,
			prefixOffset: 16,
			prefixSize: ModuleInfo.MODULE_PREFIX_SIZE
		};

		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read suffix info from P2 user part with larger module suffix containing extensions', async function () {
		const filename = path.join(settings.binaries, 'p2-user-part.bin');
		const expectedSuffixInfo = {
			productId: 32,
			productVersion: 0xbeef,
			fwUniqueId: '23b745ac727531a5d1278d32266fbb92c48150ed057c88c9bdebea962c06515d',
			reserved: 0,
			suffixSize: 62,
			crcBlock: '0e3d4f63',
			extensions: [
				{
					data: Buffer.from([0x02, 0x00, 0x10, 0x00, 0x00, 0xe0, 0x5f, 0x08, 0x88, 0xe0, 0x5f, 0x08, 0x48, 0xee, 0x3f, 0x02]),
					length: 16,
					offset: 8126,
					type: 2,
					dynalibLoadAddress: '85fe088',
					dynalibStartAddress: '23fee48',
					moduleStartAddress: '85fe000',
				},
				{
					data: Buffer.from([0x01, 0x00, 0xa, 0x00, 0xff, 0xff, 0x20, 0x00, 0xef, 0xbe]),
					length: 10,
					offset: 8142,
					type: 1,
					productId: 32,
					productVersion: 48879,
				}
			]
		};
		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.crc.ok).be.ok;
		expect(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});

	it('should read prefix info from P2 user part with larger module prefix containing extensions', async function () {
		const filename = path.join(settings.binaries, 'p2-user-part-prefix-extensions.bin');
		const expectedPrefixInfo = {
			moduleStartAddy: '85f3f90',
			moduleEndAddy: '85ffffc',
			reserved: 0,
			moduleFlags: ModuleInfo.Flags.PREFIX_EXTENSIONS,
			moduleVersion: 6,
			platformID: 32,
			moduleFunction: 5,
			moduleIndex: 1,
			depModuleFunction: 4,
			depModuleIndex: 1,
			depModuleVersion: 5300,
			dep2ModuleFunction: 0,
			dep2ModuleIndex: 0,
			dep2ModuleVersion: 0,
			prefixSize: 136,
			extensions: [
				{
					type: 18,
					length: 58,
					offset: 24,
					data: Buffer.from([
						18,   0,  58,   0,   0,  32,  18,  76, 146, 237, 146,
						22, 238,  70,  25,  17, 158, 200, 218,  26, 135,  12,
						53,  45,   6, 148,  31, 106, 180, 144, 175, 125, 151,
						71, 218, 165,  71, 224,  49,  48,  51,  95, 115, 121,
						115, 116, 101, 109,  45, 112,  97, 114, 116,  49,  46,
						98, 105, 110
					]),
					hashType: 0,
					hashLength: 32,
					hash: '124c92ed9216ee4619119ec8da1a870c352d06941f6ab490af7d9747daa547e0',
					name: '103_system-part1.bin'
				},
				{
					type: 18,
					length: 49,
					offset: 82,
					data: Buffer.from([
						18,   0,  49,   0,   0,  32, 123, 176,   1, 176,
						109, 187, 202,   6, 232, 237,  46,  92, 120, 192,
						203, 172,  89, 165, 142,   8, 247,  64, 221, 198,
						183, 106,  69,  53,  55, 160,  61,  46, 117, 110,
						107, 110, 111, 119, 110,  46,  98, 105, 110
					]),
					hashType: 0,
					hashLength: 32,
					hash: '7bb001b06dbbca06e8ed2e5c78c0cbac59a58e08f740ddc6b76a453537a03d2e',
					name: 'unknown.bin'
				},
				{
					type: 0,
					length: 5,
					offset: 131,
					data: Buffer.from([ 0, 0, 5, 0, 0 ])
				}
			],
			prefixOffset: 0
		};
		const expectedSuffixInfo = {
			productId: 32,
			productVersion: 4,
			fwUniqueId: 'a0485beefdd9a2e5c6a5f53ed37d3418defa750cc41b1e2c324759010bfedfd8',
			reserved: 0,
			suffixSize: 62,
			crcBlock: '53a6df7b',
			extensions: [
				{
					type: 2,
					length: 16,
					offset: 49198,
					data: Buffer.from([
							2,  0,  16,  0, 144, 63,
						95,  8, 136, 64,  95,  8,
						248, 81,  63,  2
					]),
					moduleStartAddress: '85f3f90',
					dynalibLoadAddress: '85f4088',
					dynalibStartAddress: '23f51f8'
				},
				{
					type: 1,
					length: 10,
					offset: 49214,
					data: Buffer.from([
							1,  0, 10, 0, 255,
						255, 32,  0, 4,   0
					]),
					productId: 32,
					productVersion: 4
				}
			]
		};
		const parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		expect(fileInfo).be.ok;
		expect(fileInfo.suffixInfo).eql(expectedSuffixInfo);
		expect(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read asset extensions from P2 application binary', async () => {
		const filename = path.join(settings.binaries, 'p2-user-part-prefix-extensions.bin');
		const parser = new HalModuleParser();
		const parsed = await parser.parseFile(filename);
		const expectedAssets = [
			{
				hashType: 0,
				hash: '124c92ed9216ee4619119ec8da1a870c352d06941f6ab490af7d9747daa547e0',
				name: '103_system-part1.bin'
			},
			{
				hashType: 0,
				hash: '7bb001b06dbbca06e8ed2e5c78c0cbac59a58e08f740ddc6b76a453537a03d2e',
				name: 'unknown.bin'
			}
		];
		expect(parsed.assets).eql(expectedAssets);
	});

	it('should read asset extensions from Tracker application binary', async () => {
		const filename = path.join(settings.binaries, 'tracker-user-part-extensions.bin');
		const parser = new HalModuleParser();
		const parsed = await parser.parseFile(filename);
		const expectedAssets = [
			{
				hash: '3a2c00b0b9b37f02b266bd75b2758638c40a7ab400353fea3ca9169552f26f63',
				hashType: 0,
				name: 'btgap.a'
			},
			{
				hash: '28c040ee247e13f230835be0a8fb50ca95b4b5548a7256c862db09140e01ef6b',
				hashType: 0,
				name: 'cat.jpg'
			},
			{
				hash: '3a54bbfb74733253df7adcc8a0e475e934c18636f44f7c94dbeb056a98d9b563',
				hashType: 0,
				name: 'km4_image2_all.bin'
			}			
		];
		expect(parsed.assets).eql(expectedAssets);
	});

	it('should read security extension from P2 bootloader binary', async () => {
		const filename = path.join(settings.binaries, 'p2-bootloader-protected.bin');
		const parser = new HalModuleParser();
		const parsed = await parser.parseFile(filename);
		expect(parsed.security.mode).eql(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
	});

	it('should read security extension from Tracker bootloader binary', async () => {
		const filename = path.join(settings.binaries, 'tracker-bootloader-protected.bin');
		const parser = new HalModuleParser();
		const parsed = await parser.parseFile(filename);
		expect(parsed.security.mode).eql(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
	});

	it('should read security extension with cert from P2 bootloader binary', async () => {
		const filename = path.join(settings.binaries, 'p2-bootloader-protected-cert.bin');
		const parser = new HalModuleParser();
		const parsed = await parser.parseFile(filename);
		expect(parsed.security.mode).eql(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
		expect(parsed.security.certificate.length).eql(300);
	});

	it('should read security extension with cert from Tracker bootloader binary', async () => {
		const filename = path.join(settings.binaries, 'tracker-bootloader-protected-cert.bin');
		const parser = new HalModuleParser();
		const parsed = await parser.parseFile(filename);
		expect(parsed.security.mode).eql(ModuleInfo.ModuleInfoSecurityMode.PROTECTED);
		expect(parsed.security.certificate.length).eql(300);
	});
});
