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

var path = require('path');
var should = require('should');
var when = require('when');
var pipeline = require('when/pipeline');

var HalModuleParser = require('../../lib/HalModuleParser.js');

var settings = {
	binaries: path.resolve(path.join(__dirname, '../binaries'))
};

//console.log('binaries dir is ' + settings.binaries);


describe('HalModuleParser', function() {
	it('should fail gracefully when the file doesn\'t exist or is empty', function(done) {
		var filename = path.join(settings.binaries, 'emptybin.bin');
		var parser = new HalModuleParser();
		parser._loadFile(filename)
			.then(
			done.bind(null, 'should have failed'),
			done.bind(null, null)
		);
	});

	it('should succeed when the file exists', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_system-part1.bin');
		var parser = new HalModuleParser();
		parser._loadFile(filename)
			.then(
			done.bind(null, null),
			done.bind(null, 'should have passed')
		);
	});


	it('should validate the CRC in the binary', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_system-part1.bin');
		var parser = new HalModuleParser();

		pipeline([
			function() {
				return parser._loadFile(filename);
			},
			function(buffer) {
				return parser._validateCRC(buffer);
			},
			function(crcInfo) {
				//console.log('got crcInfo ', crcInfo);

				should(crcInfo).be.ok;
				should(crcInfo.ok).be.ok;
				should(crcInfo.actualCrc).be.ok;
				should(crcInfo.storedCrc).eql(crcInfo.actualCrc);

				return when.resolve();
			}
		])
			.then(
			done.bind(null, null),
			done.bind(null));

	});

	it('should read prefix info from part 1', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_system-part1.bin');
		var expectedPrefixInfo = {
			moduleStartAddy: '8020000',
			moduleEndAddy: '805cba4',
			moduleVersion: 1,
			platformID: 6,
			moduleFunction: 4,
			moduleIndex: 1,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0
		};

		var parser = new HalModuleParser();
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got part 1 info ', fileInfo.prefixInfo);

				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it('should read prefix info from part 2', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_system-part2.bin');
		var expectedPrefixInfo = {
			moduleStartAddy: '8060000',
			moduleEndAddy: '807e954',
			moduleVersion: 1,
			platformID: 6,
			moduleFunction: 4,
			moduleIndex: 2,
			depModuleFunction: 4,
			depModuleIndex: 1,
			depModuleVersion: 1
		};

		var parser = new HalModuleParser();
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got part 2 info ', fileInfo.prefixInfo);
				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);

				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it('should read prefix info from a user module', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_user-part.bin');
		var expectedPrefixInfo = {
			moduleStartAddy: '80a0000',
			moduleEndAddy: '80a128c',
			moduleVersion: 2,
			platformID: 6,
			moduleFunction: 5,
			moduleIndex: 1,
			depModuleFunction: 4,
			depModuleIndex: 2,
			depModuleVersion: 1 };

		var parser = new HalModuleParser();
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got user info ', fileInfo.prefixInfo);
				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);

				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it('should read prefix info from monolithic firmware', function(done) {
		var filename = path.join(settings.binaries, '../binaries/044_Core_Tinker_P5_V10.bin');
		var expectedPrefixInfo = {
			moduleStartAddy: '8005000',
			moduleEndAddy: '801a8e0',
			moduleVersion: 0,
			platformID: 0,
			moduleFunction: 3,
			moduleIndex: 0,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0 };

		var parser = new HalModuleParser();
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got user info ', fileInfo.prefixInfo);
				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);

				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it('should read suffix info from system part 1', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_system-part1.bin');
		var expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ecb6acb4cf75ca04169f2214a24c470516cabe91683ac3664bdd174c4bb50386',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '5d7db471'
		};

		var parser = new HalModuleParser();
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got part 1 suffix ', fileInfo.suffixInfo);

				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it('should read suffix info from system part 2', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_system-part2.bin');
		var expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'ea3d9d175a6eee3d10023316240b51bea8200bdc182d0343801161b7ca53e2ae',
			reserved: 0,
			suffixSize: 36,
			crcBlock: '7db66023' };

		var parser = new HalModuleParser();
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got part 2 suffix ', fileInfo.suffixInfo);

				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});


	it('should read suffix info from the user part', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_user-part.bin');
		var expectedSuffixInfo = {
			productId: -1,
			productVersion: -1,
			fwUniqueId: 'f9f552aa98d7e3eab750862a01743024a4d05514021598a4341b3d83b37eda36',
			reserved: 0,
			suffixSize: 36,
			crcBlock: 'b138f375'
		};

		var parser = new HalModuleParser();
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got part 1 info ', fileInfo);

				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});


	it('should read info from a bootloader module', function(done) {
		var filename = path.join(settings.binaries, '../binaries/RC4_bootloader_pad_BM-09.bin');

		var expectedPrefixInfo = {
			moduleStartAddy: '8000000',
			moduleEndAddy: '8003f98',
			moduleVersion: 2,
			platformID: 6,
			moduleFunction: 2,
			moduleIndex: 0,
			depModuleFunction: 0,
			depModuleIndex: 0,
			depModuleVersion: 0
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
		parser.parseFile(filename)
			.then(
			function(fileInfo) {
				//console.log('got bootloader info ', fileInfo);

				should(fileInfo).be.ok;

				//bootloader CRC is actually bad
				//should(fileInfo.crc.ok).be.ok;

				should(fileInfo.suffixInfo).eql(expectedSuffixInfo);
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it('should have a working example', function(done) {
		var filename = path.join(settings.binaries, '../binaries/040_user-part.bin');
		var Reader = require('../../main.js').HalModuleParser;
		var reader = new Reader();
		reader.parseFile(filename, function(fileInfo, err) {
			should(fileInfo).be.ok;
			done();
		});
	});
         
    it('should work with bluz system-part', function(done) {
       var filename = path.join(settings.binaries, '../binaries/103_system-part1.bin');
       var expectedPrefixInfo = {
       moduleStartAddy: '18000',
       moduleEndAddy: '36768',
       moduleVersion: 1,
       platformID: 103,
       moduleFunction: 4,
       moduleIndex: 1,
       depModuleFunction: 0,
       depModuleIndex: 0,
       depModuleVersion: 0
       };
       
       var parser = new HalModuleParser();
       parser.parseFile(filename)
       .then(
             function(fileInfo) {
                 //console.log('got part 2 info ', fileInfo.prefixInfo);
                 should(fileInfo).be.ok;
                 should(fileInfo.crc.ok).be.ok;
                 should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
                 
                 done();
             },
             function(err) {
                 done(err)
             }).catch(done);
    });
});
