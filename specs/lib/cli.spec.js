import { describe, it, expect } from 'vitest';
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.resolve(__dirname, '../../cli.js');
const BINARIES = path.resolve(__dirname, '../binaries');

describe('CLI', function () {
	it('outputs valid JSON for a valid binary', function () {
		const result = spawnSync(process.execPath, [CLI, path.join(BINARIES, 'p2-tinker@5.3.1.bin')]);
		const stdout = result.stdout.toString();
		const parsed = JSON.parse(stdout);
		expect(parsed).to.have.property('prefixInfo');
		expect(parsed).to.have.property('suffixInfo');
		expect(parsed).to.have.property('crc');
		expect(parsed).to.not.have.property('fileBuffer');
	});

	it('exits with code 1 and prints to stderr when file does not exist', function () {
		const result = spawnSync(process.execPath, [CLI, 'nonexistent.bin']);
		expect(result.status).to.equal(1);
		expect(result.stderr.toString()).to.match(/doesn't exist/);
	});
});
