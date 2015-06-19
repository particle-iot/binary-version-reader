/**
 * Created by middleca on 6/18/15.
 */

var test_data = require('./describe.json.js');
var HalDependencyResolver = require ("../../lib/HalDependencyResolver.js");
var should = require('should');

describe("HalDependencyResolver", function() {

//	it("makes sense out of this", function(done) {
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

		var photon_reported_modules = require('./describe.json.js').m;
		var fixed_test_data = require('./fixed_describe.json.js').m;

		var resolver = new HalDependencyResolver();
		var result = resolver.repairDescribeErrors(photon_reported_modules);

		should(result).eql(fixed_test_data);
	});

});