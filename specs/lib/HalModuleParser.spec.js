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

var fs = require('fs');
var path = require('path');
var should = require('should');
var BufferOffset = require('buffer-offset');

var HalModuleParser = require('../../lib/HalModuleParser.js');
var ModuleInfo = require('../../lib/ModuleInfo.js');
var createFirmwareBinary = require('../../lib/firmwareTestHelper').createFirmwareBinary;
var config = require('../../lib/config.js').config;

var settings = {
	binaries: path.resolve(path.join(__dirname, '../binaries'))
};


describe('HalModuleParser', function () {
	it('should fail gracefully when the file doesn\'t exist or is empty', async function () {
		var filename = path.join(settings.binaries, 'emptybin.bin');
		var parser = new HalModuleParser();
		try {
			await parser._loadFile(filename);
			throw new Error('should have failed');
		} catch (err) {}
	});

	it('should succeed when the file exists', async function () {
		var filename = path.join(settings.binaries, '040_system-part1.bin');
		var parser = new HalModuleParser();
		return parser._loadFile(filename);
	});


	it('should validate the CRC in the binary', async function () {
		var filename = path.join(settings.binaries, '040_system-part1.bin');
		var parser = new HalModuleParser();

		const buffer = await parser._loadFile(filename);
		const crcInfo = await parser._validateCRC(buffer);
		should(crcInfo).be.ok;
		should(crcInfo.ok).be.ok;
		should(crcInfo.actualCrc).be.ok;
		should(crcInfo.storedCrc).eql(crcInfo.actualCrc);
	});

	it('should read prefix info from part 1', async function () {
		var filename = path.join(settings.binaries, '040_system-part1.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read prefix info from part 2', async function () {
		var filename = path.join(settings.binaries, '040_system-part2.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read prefix info from a user module', async function () {
		var filename = path.join(settings.binaries, '040_user-part.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read prefix info from monolithic firmware', async function () {
		var filename = path.join(settings.binaries, '044_Core_Tinker_P5_V10.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read suffix info from system part 1', async function () {
		var filename = path.join(settings.binaries, '040_system-part1.bin');
		var expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ecb6acb4cf75ca04169f2214a24c470516cabe91683ac3664bdd174c4bb50386',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '5d7db471'
		};

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});

	it('should read suffix info from system part 2', async function () {
		var filename = path.join(settings.binaries, '040_system-part2.bin');
		var expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ea3d9d175a6eee3d10023316240b51bea8200bdc182d0343801161b7ca53e2ae',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '7db66023'
		};

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});


	it('should read suffix info from the user part', async function () {
		var filename = path.join(settings.binaries, '040_user-part.bin');
		var expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'f9f552aa98d7e3eab750862a01743024a4d05514021598a4341b3d83b37eda36',
			reserved: 0,
			suffixSize: 36,
			crcBlock: 'b138f375'
		};

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});


	it('should read info from a bootloader module', async function () {
		var filename = path.join(settings.binaries, 'RC4_bootloader_pad_BM-09.bin');

		var expectedPrefixInfo = {
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

		var expectedSuffixInfo = {
			productId: 65535,
			productVersion: 65535,
			fwUniqueId: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
			reserved: 65535,
			suffixSize: 65535,
			crcBlock: 'ffffffff'
		};

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should have a working example', async function () {
		var filename = path.join(settings.binaries, '040_user-part.bin');
		var Reader = require('../../main.js').HalModuleParser;
		var reader = new Reader();
		const fileInfo = await reader.parseFile(filename);
		should(fileInfo).be.ok;
	});

	it('should work with bluz system-part', async function () {
		var filename = path.join(settings.binaries, '103_system-part1.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with xenon system part', async function () {
		var filename = path.join(settings.binaries, '080_system-part1-xenon.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with xenon user part', async function () {
		var filename = path.join(settings.binaries, '080_user-part-xenon.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with xenon bootloader', async function () {
		var filename = path.join(settings.binaries, '080_bootloader-xenon.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with argon ncp', async function () {
		var filename = path.join(settings.binaries, 'argon-ncp-firmware-0.0.5-ota.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with boron-som system part', async function () {
		var filename = path.join(settings.binaries, 'boron-som-system-part1@1.1.0-rc.1.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should work with argon softdevice (radio stack)', async function () {
		var filename = path.join(settings.binaries, 'argon-softdevice-6.1.1.bin');
		var expectedPrefixInfo = {
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

		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	describe('given a module descriptor', function () {
		function buildModule(module) {
			var buffer = BufferOffset.convert(Buffer.alloc(24));
			return appendModule(buffer, module);
		}

		function appendModule(buffer, module) {
			buffer.appendUInt32LE(module.moduleStartAddy);
			buffer.appendUInt32LE(module.moduleEndAddy);
			buffer.appendUInt16LE(0);       // reserved
			buffer.appendUInt16LE(module.moduleVersion);
			buffer.appendUInt16LE(module.platformID);
			buffer.appendUInt8(module.moduleFunction);
			buffer.appendUInt8(module.moduleIndex);
			appendModuleDependency(buffer, module.depModuleFunction, module.depModuleIndex, module.depModuleVersion);
			appendModuleDependency(buffer, module.dep2ModuleFunction, module.dep2ModuleIndex, module.dep2ModuleVersion);
			return buffer;
		}

		function appendModuleDependency(buffer, f, n, v) {
			buffer.appendUInt8(f);
			buffer.appendUInt8(n);
			buffer.appendUInt16LE(v);
			return buffer;
		}

		var buffer;

		var testModule1 = {
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
			var module;
			beforeEach(function () {
				var parser = new HalModuleParser();
				var buf = Buffer.alloc(buffer.length);
				buffer.copy(buf);
				parser._findModulePrefixOffset = function () {
					return 0;
				};
				module = parser._readPrefix(buffer);
			});

			it('parses the module version as 16-bits LE', function () {
				should(module).have.property('depModuleVersion').eql(345);
			});

			it('parses the 2nd module version as 16-bits LE', function () {
				should(module).have.property('dep2ModuleVersion').eql(3456);
			});

		});

	});

	it('allows parsing prefix and suffix info separately', function () {
		var file = path.join(settings.binaries, '040_system-part1.bin');
		var expectedPrefixInfo = {
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
		var expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ecb6acb4cf75ca04169f2214a24c470516cabe91683ac3664bdd174c4bb50386',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '5d7db471'
		};
		var fileBuffer = fs.readFileSync(file);
		var parser = new HalModuleParser();
		return parser.parsePrefix({ fileBuffer: fileBuffer })
			.then(function (fileInfo) {
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
				should(fileInfo).not.have.property('suffixInfo');
				return parser.parseSuffix({ fileBuffer: fileBuffer });
			})
			.then(function (fileInfo) {
				should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
				should(fileInfo).not.have.property('prefixInfo');
			})
	});

	describe('given that a custom CRC-32 function is provided globally', function () {
		var defaultCrc32 = null;

		before(function () {
			defaultCrc32 = config().crc32;
		});

		afterEach(function () {
			config({ crc32: defaultCrc32 });
		});

		it('uses that function for CRC-32 computations', function () {
			var dummyCrc = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
			config({
				crc32: function (buf) {
					return dummyCrc;
				}
			});
			var parser = new HalModuleParser();
			return parser.parseBuffer({ fileBuffer: createFirmwareBinary() })
				.then(function (fileInfo) {
					should(fileInfo.crc.actualCrc).eql(dummyCrc.toString('hex'));
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
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
	});

	it('should read suffix info from P2 user part with larger module suffix containing extensions', async function () {
		var filename = path.join(settings.binaries, 'p2-user-part.bin');
		var expectedSuffixInfo = {
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
		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.crc.ok).be.ok;
		should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
	});

	it('should read prefix info from P2 user part with larger module prefix containing extensions', async function () {
		var filename = path.join(settings.binaries, 'p2-user-part-prefix-extensions.bin');
		var expectedPrefixInfo = {
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
		var expectedSuffixInfo = {
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
		var parser = new HalModuleParser();
		const fileInfo = await parser.parseFile(filename);
		should(fileInfo).be.ok;
		should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
		should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
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
		should(parsed.assets).eql(expectedAssets);
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
		should(parsed.assets).eql(expectedAssets);
	});
});
