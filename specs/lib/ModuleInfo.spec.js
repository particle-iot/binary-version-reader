'use strict';

const path = require('path');
const HalModuleParser = require('../../lib/HalModuleParser.js');
const ModuleInfo = require('../../lib/ModuleInfo.js');
var should = require('should');

const settings = {
	binaries: path.resolve(path.join(__dirname, '../binaries'))
};

describe('ModuleInfo', () => {

	it('converts an application file to a describe module', () => {

		var filename = path.join(settings.binaries, '040_user-part.bin');
		var expectedPrefixInfo = {
			moduleStartAddy: '80a0000',
			moduleEndAddy: '80a128c',
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
			dep2ModuleVersion: 0
		};

		const expectedDescribe = {
			n: '1',
			f: 'u',
			v: 2,
			d: [
				{ f: 's', v: 1, n: '2' }        // note that the name is a string, while version is not.
			]
		};

		var parser = new HalModuleParser();
		return parser.parseFile(filename)
			.then(fileInfo => {
				//console.log('got user info ', fileInfo.prefixInfo);
				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);

				const describe = ModuleInfo.parsedModuleToDescribe(fileInfo);
				should(describe).eql(expectedDescribe);
			});
	});

});
