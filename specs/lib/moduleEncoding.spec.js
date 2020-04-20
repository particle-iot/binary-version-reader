const {
	updateModuleSha256,
	updateModuleCrc32,
	updateModulePrefix,
	updateModuleSuffix,
	compressModule,
	decompressModule
} = require('../../lib/moduleEncoding');

const HalModuleParser = require('../../lib/HalModuleParser');
const { MODULE_PREFIX_SIZE } = require('../../lib/ModuleInfo');
const { createFirmwareBinary } = require('../../lib/firmwareTestHelper');

const crc32 = require('buffer-crc32');
const { expect } = require('chai');

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const TEST_BINARIES_PATH = path.resolve(path.join(__dirname, '../binaries'));

// Exclude some old and malformed firmware binaries from the test
const EXCLUDED_TEST_BINARIES = [
	'emptybin.bin',
	'RC2_bootloader.bin',
	'RC4_bootloader_pad_BM-09.bin',
	'RC4_bootloader_pad_BM-14.bin'
];

const TEST_BINARIES = fs.readdirSync(TEST_BINARIES_PATH)
		.filter(f => f.endsWith('.bin') && !EXCLUDED_TEST_BINARIES.includes(f))
		.map(f => path.join(TEST_BINARIES_PATH, f));

const SHA256_OFFSET = 38; // Relative to the end of the module data
const CRC32_OFFSET = 4; // ditto

function genRandomBuffer(size = 1024) {
	const buf = Buffer.alloc(size);
	for (let i = 0; i < buf.length; ++i) {
		buf[i] = Math.floor(Math.random() * 256);
	}
	return buf;
}

function genModuleBinary({ data, addVectorTable } = {}) {
	return createFirmwareBinary({
		buffer: data || genRandomBuffer(),
		productId: 0xabcd,
		productVersion: 0x1234,
		platformId: 10,
		addVectorTable
	});
}

async function parseModuleBinary(data) {
	const parser = new HalModuleParser();
	const info = await parser.parseBuffer({ fileBuffer: data });
	return info;
}

describe('moduleEncoding', () => {
	describe('updateModulePrefix()', () => {
		it('can update prefix fields selectively', async () => {
			const bin = genModuleBinary();
			let prefixInfo = {
				moduleStartAddy: 0x44332211,
				// moduleEndAddy: 0x88776655,
				reserved: 0x99,
				// moduleFlags: 0xaa,
				moduleVersion: 0xccbb,
				// platformID: 0xeedd,
				moduleFunction: 0xff,
				// moduleIndex: 0x11,
				depModuleFunction: 0x22,
				// depModuleIndex: 0x33,
				depModuleVersion: 0x5544,
				// dep2ModuleFunction: 0x66,
				dep2ModuleIndex: 0x77,
				// dep2ModuleVersion: 0x9988
			};
			bin.fill(0, 0, MODULE_PREFIX_SIZE);
			updateModulePrefix(bin, prefixInfo);
			let d = bin.slice(0, MODULE_PREFIX_SIZE);
			expect(d.toString('hex')).to.equal('11223344000000009900bbcc0000ff002200445500770000');
			prefixInfo = {
				// moduleStartAddy: 0x44332211,
				moduleEndAddy: 0x88776655,
				// reserved: 0x99,
				moduleFlags: 0xaa,
				// moduleVersion: 0xccbb,
				platformID: 0xeedd,
				// moduleFunction: 0xff,
				moduleIndex: 0x11,
				// depModuleFunction: 0x22,
				depModuleIndex: 0x33,
				// depModuleVersion: 0x5544,
				dep2ModuleFunction: 0x66,
				// dep2ModuleIndex: 0x77,
				dep2ModuleVersion: 0x9988
			};
			bin.fill(0, 0, MODULE_PREFIX_SIZE);
			updateModulePrefix(bin, prefixInfo);
			d = bin.slice(0, MODULE_PREFIX_SIZE);
			expect(d.toString('hex')).to.equal('000000005566778800aa0000ddee00110033000066008899');
		});

		it('correctly updates test module binaries', async () => {
			for (let file of TEST_BINARIES) {
				const origBin = fs.readFileSync(file);
				const { prefixInfo } = await parseModuleBinary(origBin);
				const bin = Buffer.from(origBin);
				bin.fill(0, prefixInfo.prefixOffset, prefixInfo.prefixOffset + MODULE_PREFIX_SIZE);
				updateModulePrefix(bin, prefixInfo);
				expect(bin.equals(origBin)).to.be.true;
			}
		});
	});

	describe('updateModuleSuffix()', () => {
		it('can update suffix fields selectively', async () => {
			const bin = genModuleBinary();
			let suffixInfo = {
				productId: 0x2211,
				// productVersion: 0x4433,
				reserved: 0x6655,
				// fwUniqueId: '778899aabbccddeeff112233445566778899aabbccddeeff1122334455667788',
				crcBlock: '99aabbcc',
				suffixSize: 40 // Mandatory
			};
			const offs = bin.length - suffixInfo.suffixSize - 4;
			const size = suffixInfo.suffixSize + 4; // Including CRC-32
			bin.fill(0, offs, offs + size);
			updateModuleSuffix(bin, suffixInfo);
			let d = bin.slice(offs, offs + size);
			expect(d.toString('hex')).to.equal('1122000055660000000000000000000000000000000000000000000000000000000000000000280099aabbcc');
			suffixInfo = {
				// productId: 0x2211,
				productVersion: 0x4433,
				// reserved: 0x6655,
				fwUniqueId: '778899aabbccddeeff112233445566778899aabbccddeeff1122334455667788',
				// crcBlock: '99aabbcc',
				suffixSize: 40
			};
			bin.fill(0, offs, offs + size);
			updateModuleSuffix(bin, suffixInfo);
			d = bin.slice(offs, offs + size);
			expect(d.toString('hex')).to.equal('000033440000778899aabbccddeeff112233445566778899aabbccddeeff1122334455667788280000000000');
		});

		it('correctly updates test module binaries', async () => {
			for (let file of TEST_BINARIES) {
				const origBin = fs.readFileSync(file);
				const { suffixInfo } = await parseModuleBinary(origBin);
				const bin = Buffer.from(origBin);
				const offs = bin.length - suffixInfo.suffixSize - 4;
				const size = suffixInfo.suffixSize + 4; // Including CRC-32
				bin.fill(0, offs, offs + size);
				updateModuleSuffix(bin, suffixInfo);
				expect(bin.equals(origBin)).to.be.true;
			}
		});
	});

	describe('compressModule() / decompressModule()', () => {
		it('compress and decompress test module binaries', async () => {
			for (let file of TEST_BINARIES) {
				const origBin = fs.readFileSync(file);
				const compBin = await compressModule(origBin);
				expect(compBin.length).to.be.lessThan(origBin.length);
				const decompBin = await decompressModule(compBin);
				expect(decompBin.equals(origBin)).to.be.true;
			}
		});
	});

	describe('updateModuleSha256()', () => {
		it('updates the SHA-256 checksum of a module', async () => {
			const bin = genModuleBinary();
			let hash = crypto.createHash('sha256');
			hash.update(bin.slice(0, bin.length - SHA256_OFFSET));
			hash = hash.digest();
			bin.fill(0, bin.length - SHA256_OFFSET);
			updateModuleSha256(bin);
			let { suffixInfo } = await parseModuleBinary(bin);
			expect(suffixInfo.fwUniqueId).to.equal(hash.toString('hex'));
		});
	});

	describe('updateModuleCrc32()', () => {
		it('updates the CRC-32 checksum of a module', async () => {
			const bin = genModuleBinary();
			const crc = crc32(bin.slice(0, bin.length - CRC32_OFFSET));
			bin.fill(0, bin.length - CRC32_OFFSET);
			updateModuleCrc32(bin);
			let { suffixInfo } = await parseModuleBinary(bin);
			expect(suffixInfo.crcBlock).to.equal(crc.toString('hex'));
		});
	});
});
