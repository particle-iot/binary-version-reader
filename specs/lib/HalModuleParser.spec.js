/**
 * Created by middleca on 6/11/15.
 */

var path = require("path");
var should = require("should");
var when = require('when');
var pipeline = require('when/pipeline');

var HalModuleParser = require('../../lib/HalModuleParser.js');

var settings = {
	binaries: path.resolve(path.join(__dirname, "../binaries"))
};

console.log("binaries dir is " + settings.binaries);


describe("HalModuleParser", function() {
	it("should fail gracefully when the file doesn't exist or is empty", function(done) {
		var filename = path.join(settings.binaries, "emptybin.bin");
		var parser = new HalModuleParser();
		parser._loadFile(filename)
			.then(
			done.bind(null, "should have failed"),
			done.bind(null, null)
		);
	});

	it("should succeed when the file exists", function(done) {
		var filename = path.join(settings.binaries, "../binaries/040_system-part1.bin");
		var parser = new HalModuleParser();
		parser._loadFile(filename)
			.then(
			done.bind(null, null),
			done.bind(null, "should have passed")
		);
	});


	it("should validate the CRC in the binary", function(done) {
		var filename = path.join(settings.binaries, "../binaries/040_system-part1.bin");
		var parser = new HalModuleParser();

		pipeline([
			function() {
				return parser._loadFile(filename);
			},
			function(buffer) {
				return parser._validateCRC(buffer);
			},
			function(crcInfo) {
				//console.log("got crcInfo ", crcInfo);

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

	it("should read prefix info from part 1", function(done) {
		var filename = path.join(settings.binaries, "../binaries/040_system-part1.bin");
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
				//console.log("got part 1 info ", fileInfo);

				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);
				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it("should read prefix info from part 2", function(done) {
		var filename = path.join(settings.binaries, "../binaries/040_system-part2.bin");
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
				//console.log("got part 2 info ", fileInfo);
				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);

				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});

	it("should read prefix info from a user module", function(done) {
		var filename = path.join(settings.binaries, "../binaries/040_user-part.bin");
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
				//console.log("got user info ", fileInfo);
				should(fileInfo).be.ok;
				should(fileInfo.crc.ok).be.ok;
				should(fileInfo.prefixInfo).eql(expectedPrefixInfo);

				done();
			},
			function(err) {
				done(err)
			}).catch(done);
	});


	it("should read info from a bootloader module");
	it("should know what kind of module it's looking at");
});