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
 * Created by middleca on 6/18/15.
 */

var fs = require('fs');
var path = require('path');
var should = require('should');
var when = require('when');
var pipeline = require('when/pipeline');
var HalDependencyResolver = require ('../../lib/HalDependencyResolver.js');

var settings = {
	binaries: path.resolve(path.join(__dirname, '../binaries'))
};


describe('HalDependencyResolver', function() {


	it('repairs errors in module names and versions', function() {
		var photonReportedModules = require('./../describes/describe.json.js').m;
		var fixedTestData = require('./../describes/fixed_describe.json.js').m;

		var resolver = new HalDependencyResolver();
		var result = resolver._repairDescribeErrors(photonReportedModules);

		should(result).eql(fixedTestData);
	});

	it('converts binary metadata into describe format', function() {
		var userPrefixInfo = {
			depModuleFunction: 4,
			depModuleIndex: 2,
			depModuleVersion: 1
		};

		var expectedDescribe = {
			f: 's',
			n: '2',
			v: 1
		};

		var resolver = new HalDependencyResolver();
		var result = resolver._binaryDepsToDescribe(userPrefixInfo);

		should(result).eql(expectedDescribe);
	});


	it('walk a dependency chain nicely', function() {
		var fixedTestData = require('./../describes/fixed_describe.json.js').m;
		var safeBinaryReqs = {
			f: 's',
			n: '2',
			v: 1
		};

		var resolver = new HalDependencyResolver();
		var arr = resolver._walkChain(fixedTestData, safeBinaryReqs);
		should(arr).eql([]);
	});

	it('flag a module for update when out of version', function() {
		var fixedTestData = require('./../describes/fixed_describe.json.js').m;
		var systemPart2 = fixedTestData[2];

		var safeBinaryReqs = {
			f: 's',
			n: '2',
			v: systemPart2.v + 1
		};

		var resolver = new HalDependencyResolver();
		var arr = resolver._walkChain(fixedTestData, safeBinaryReqs);
		should(arr.length).eql(1);
		should(arr[0]).eql(systemPart2);
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
	it('passes a full test', function(done) {

		var resolver = new HalDependencyResolver();

		var part1 = path.join(settings.binaries, '../binaries/040_system-part1.bin');
		var part2 = path.join(settings.binaries, '../binaries/040_system-part2.bin');

		// load those modules in!
		resolver.assimilateModule(part1);
		resolver.assimilateModule(part2);


		var describeFilename = path.join(settings.binaries, '../describes/old_describe.json.js');
		var oldDescribe = require(describeFilename).m;

		var userFirmware = path.join(settings.binaries, '../binaries/040_user-part.bin');
		var fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		var result = resolver.parseAndResolve(oldDescribe, fileBuffer)
			.then(function(result) {
				should(result).be.ok;
				console.log('dependency resolve result had ', result.length, ' items ');
				should(result.length).eql(2);

				//the first thing should be part1, and the second thing part2

				should(result[0].filename).endWith('system-part1.bin');
				should(result[1].filename).endWith('system-part2.bin');

				done();
			}, function(err) {
				done(err);
			}).catch(function(err) {
				done(err);
			});
	});

	it('recommend modules when going from 042 to 043', function(done) {

		var resolver = new HalDependencyResolver();

		var part1 = path.join(settings.binaries, '../binaries/043_system-part1.bin');
		var part2 = path.join(settings.binaries, '../binaries/043_system-part2.bin');

		// load those modules in!
		resolver.assimilateModule(part1);
		resolver.assimilateModule(part2);


		var describeFilename = path.join(settings.binaries, '../describes/042_describe.json.js');
		var oldDescribe = require(describeFilename).m;

		var userFirmware = path.join(settings.binaries, '../binaries/043_user-part.bin');
		var fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		var result = resolver.parseAndResolve(oldDescribe, fileBuffer)
			.then(function(result) {
				should(result).be.ok;
				console.log('dependency resolve result had ', result.length, ' items ');
				should(result.length).eql(2);

				//the first thing should be part1, and the second thing part2

				should(result[0].filename).endWith('system-part1.bin');
				should(result[1].filename).endWith('system-part2.bin');

				done();
			}, function(err) {
				done(err);
			}).catch(function(err) {
				done(err);
			});
	});


});
