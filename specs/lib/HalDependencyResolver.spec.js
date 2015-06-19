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

//	it("makes sense out of this", function(done) {
//		var test_data = require('./../describes/describe.json.js');
//		var photon_reported_modules = test_data.m;
//
//		// from the dependency region of the binary metadata encoded in the binary
//		// requires that the system module named "1", should be at version 1
//		var new_binary_requires = [
//			{
//				f: "s",
//				n: "1",
//				v: 1
//			}
//		];
//
//		var resolver = new HalDependencyResolver();
//		resolver.solve(photon_reported_modules, new_binary_requires);
//	});


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


	it("passes a full test", function(done) {

		var resolver = new HalDependencyResolver();

		var part1 = path.join(settings.binaries, "../binaries/040_system-part1.bin");
		var part2 = path.join(settings.binaries, "../binaries/040_system-part2.bin");

		// load those modules in!
		resolver.assimilateModule(part1);
		resolver.assimilateModule(part2);


		var old_describe = path.join(settings.binaries, "../describes/old_describe.json.js");
		var userFirmware = path.join(settings.binaries, "../binaries/040_user-part.bin");
		var fileBuffer = fs.readFileSync(userFirmware);

		var result = resolver.parse_and_resolve(old_describe, fileBuffer)
			.then(function(result) {
				console.log("dependency resolve result was ", JSON.stringify(result));
				done();
			}, function(err) {
				done(err);
			});
	});

});