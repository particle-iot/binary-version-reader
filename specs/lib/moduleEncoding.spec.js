const {
	updateModuleSha256,
	updateModuleCrc32,
	updateModulePrefix,
	updateModuleData,
	extractModuleData
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
const TEST_BINARIES = fs.readdirSync(TEST_BINARIES_PATH)
		.filter(f => f.endsWith('.bin'))
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
				let prefixInfo = null;
				try {
					({ prefixInfo } = await parseModuleBinary(origBin));
				} catch (err) {
					continue; // Skip modules that can't be parsed
				}
				const bin = Buffer.from(origBin);
				bin.fill(0, prefixInfo.prefixOffset, prefixInfo.prefixOffset + MODULE_PREFIX_SIZE);
				updateModulePrefix(bin, prefixInfo);
				expect(bin.equals(origBin)).to.be.true;
			}
		});
	});

	describe('extractModuleData()', () => {
		it('extracts the data from a module without a vector table', async () => {
			const data = genRandomBuffer();
			const bin = genModuleBinary({ data });
			const { prefixInfo, suffixInfo } = await parseModuleBinary(bin);
			const d = extractModuleData(bin, prefixInfo, suffixInfo);
			expect(d.equals(data)).to.be.true;
		});

		it('extracts the data from a module with a vector table', async () => {
			const data = genRandomBuffer();
			const bin = genModuleBinary({ data, addVectorTable: true });
			const { prefixInfo, suffixInfo } = await parseModuleBinary(bin);
			const d = extractModuleData(bin, prefixInfo, suffixInfo);
			expect(d.equals(data)).to.be.true;
		});
	});

	describe('updateModuleData()', () => {
		it('updates the data of a module without a vector table', async () => {
			let bin = genModuleBinary();
			const { prefixInfo, suffixInfo } = await parseModuleBinary(bin);
			const data = genRandomBuffer();
			bin = updateModuleData(bin, data, prefixInfo, suffixInfo);
			const d = extractModuleData(bin, prefixInfo, suffixInfo);
			expect(d.equals(data)).to.be.true;
		});

		it('updates the data of a module with a vector table', async () => {
			let bin = genModuleBinary({ addVectorTable: true });
			const { prefixInfo, suffixInfo } = await parseModuleBinary(bin);
			const data = genRandomBuffer();
			bin = updateModuleData(bin, data, prefixInfo, suffixInfo);
			const d = extractModuleData(bin, prefixInfo, suffixInfo);
			expect(d.equals(data)).to.be.true;
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
