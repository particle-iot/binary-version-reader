var path = require('path');
var { spawnSync } = require('child_process');

var CLI = path.resolve(__dirname, '../../cli.js');
var BINARIES = path.resolve(__dirname, '../binaries');

describe('CLI', function () {
	it('outputs valid JSON for a valid binary', function () {
		var result = spawnSync(process.execPath, [CLI, path.join(BINARIES, 'p2-tinker@5.3.1.bin')]);
		var stdout = result.stdout.toString();
		var parsed = JSON.parse(stdout);
		parsed.should.have.property('prefixInfo');
		parsed.should.have.property('suffixInfo');
		parsed.should.have.property('crc');
		parsed.should.not.have.property('fileBuffer');
	});

	it('exits with code 1 and prints to stderr when file does not exist', function () {
		var result = spawnSync(process.execPath, [CLI, 'nonexistent.bin']);
		result.status.should.equal(1);
		result.stderr.toString().should.match(/doesn't exist/);
	});
});
