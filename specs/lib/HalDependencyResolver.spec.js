/**
 * Created by middleca on 6/18/15.
 */

var fs = require('fs');
var path = require("path");
var should = require('should');
var when = require('when');
var pipeline = require('when/pipeline');
var HalDependencyResolver = require ("../../lib/HalDependencyResolver.js");

var settings = {
	binaries: path.resolve(path.join(__dirname, "../binaries"))
};


describe("HalDependencyResolver", function() {


	it("repairs errors in module names and versions", function() {
		var photon_reported_modules = require('./../describes/describe.json.js').m;
		var fixed_test_data = require('./../describes/fixed_describe.json.js').m;

		var resolver = new HalDependencyResolver();
		var result = resolver._repairDescribeErrors(photon_reported_modules);

		should(result).eql(fixed_test_data);
	});

	it("converts binary metadata into describe format", function() {
		var userPrefixInfo = {
			depModuleFunction: 4,
			depModuleIndex: 2,
			depModuleVersion: 1
		};

		var expected_describe = {
			f: "s",
			n: "2",
			v: 1
		};

		var resolver = new HalDependencyResolver();
		var result = resolver._binary_deps_to_describe(userPrefixInfo);

		should(result).eql(expected_describe);
	});


	it("walk a dependency chain nicely", function() {
		var fixed_test_data = require('./../describes/fixed_describe.json.js').m;
		var safe_binary_reqs = {
			f: "s",
			n: "2",
			v: 1
		};

		var resolver = new HalDependencyResolver();
		var arr = resolver._walk_chain(fixed_test_data, safe_binary_reqs);
		should(arr).eql([]);
	});

	it("flag a module for update when out of version", function() {
		var fixed_test_data = require('./../describes/fixed_describe.json.js').m;
		var system_part2 = fixed_test_data[2];

		var safe_binary_reqs = {
			f: "s",
			n: "2",
			v: system_part2.v + 1
		};

		var resolver = new HalDependencyResolver();
		var arr = resolver._walk_chain(fixed_test_data, safe_binary_reqs);
		should(arr.length).eql(1);
		should(arr[0]).eql(system_part2);
	});


	/**
	 * loads the system parts,
	 * reads their binary info,
	 *
	 * passes in a user binary
	 * reads its binary info / dependencies
	 *
	 * walks recursively up the dependency chain
	 *
	 * matches dependencies to our known good modules,
	 *
	 * AND RETURNS THEM.
	 *
	 *
		 ______     __     __     ______     ______     ______
		/\  ___\   /\ \  _ \ \   /\  ___\   /\  ___\   /\__  _\
		\ \___  \  \ \ \/ ".\ \  \ \  __\   \ \  __\   \/_/\ \/
		 \/\_____\  \ \__/".~\_\  \ \_____\  \ \_____\    \ \_\
		  \/_____/   \/_/   \/_/   \/_____/   \/_____/     \/_/

	 */
	it("passes a full test", function(done) {

		var resolver = new HalDependencyResolver();

		var part1 = path.join(settings.binaries, "../binaries/040_system-part1.bin");
		var part2 = path.join(settings.binaries, "../binaries/040_system-part2.bin");

		// load those modules in!
		resolver.assimilateModule(part1);
		resolver.assimilateModule(part2);


		var describeFilename = path.join(settings.binaries, "../describes/old_describe.json.js");
		var old_describe = require(describeFilename).m;

		var userFirmware = path.join(settings.binaries, "../binaries/040_user-part.bin");
		var fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		var result = resolver.parse_and_resolve(old_describe, fileBuffer)
			.then(function(result) {
				should(result).be.ok;
				console.log("dependency resolve result had ", result.length, " items ");
				should(result.length).eql(2);

				//the first thing should be part1, and the second thing part2

				should(result[0].filename).endWith("system-part1.bin");
				should(result[1].filename).endWith("system-part2.bin");

				done();
			}, function(err) {
				done(err);
			}).catch(function(err) {
				done(err);
			});
	});

	it("recommend modules when going from 042 to 043", function(done) {

		var resolver = new HalDependencyResolver();

		var part1 = path.join(settings.binaries, "../binaries/043_system-part1.bin");
		var part2 = path.join(settings.binaries, "../binaries/043_system-part2.bin");

		// load those modules in!
		resolver.assimilateModule(part1);
		resolver.assimilateModule(part2);


		var describeFilename = path.join(settings.binaries, "../describes/042_describe.json.js");
		var old_describe = require(describeFilename).m;

		var userFirmware = path.join(settings.binaries, "../binaries/043_user-part.bin");
		var fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		var result = resolver.parse_and_resolve(old_describe, fileBuffer)
			.then(function(result) {
				should(result).be.ok;
				console.log("dependency resolve result had ", result.length, " items ");
				should(result.length).eql(2);

				//the first thing should be part1, and the second thing part2

				should(result[0].filename).endWith("system-part1.bin");
				should(result[1].filename).endWith("system-part2.bin");

				done();
			}, function(err) {
				done(err);
			}).catch(function(err) {
				done(err);
			});
	});


});