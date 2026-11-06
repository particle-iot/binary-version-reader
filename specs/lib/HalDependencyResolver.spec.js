'use strict';
import { describe, it, expect } from 'vitest';
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

const fs = require('fs');
const path = require('path');
const HalDependencyResolver = require ('../../lib/HalDependencyResolver.js');
const FirmwareModule = require('../../lib/FirmwareModule');

const settings = {
	binaries: path.resolve(path.join(__dirname, '../binaries'))
};


describe('HalDependencyResolver', function() {


	it('logs and skips a module that fails to parse', async function() {
		const resolver = new HalDependencyResolver();
		const errors = [];
		const originalConsoleError = console.error;
		console.error = (...args) => errors.push(args);
		try {
			await resolver.assimilateModule(path.join(settings.binaries, 'emptybin.bin'));
		} finally {
			console.error = originalConsoleError;
		}
		expect(errors).to.have.lengthOf(1);
		expect(errors[0][1]).to.be.an('error').with.property('message').that.includes('was empty');
		expect(resolver._moduleStorage).to.eql([]);
	});

	it('repairs errors in module names and versions', function() {
		const photonReportedModules = require('./../describes/describe.json.js').m;
		const fixedTestData = require('./../describes/fixed_describe.json.js').m;

		const resolver = new HalDependencyResolver();
		const result = resolver._repairDescribeErrors(photonReportedModules);

		expect(result).eql(fixedTestData);
	});

	it('converts binary metadata into describe format', function() {
		const userPrefixInfo = {
			depModuleFunction: 4,
			depModuleIndex: 2,
			depModuleVersion: 1
		};

		const expectedDescribe = {
			f: 's',
			n: '2',
			v: 1
		};

		const resolver = new HalDependencyResolver();
		const result = resolver._binaryDepsToDescribe(userPrefixInfo);

		expect(result).eql(expectedDescribe);
	});


	it('walk a dependency chain nicely', function() {
		const fixedTestData = require('./../describes/fixed_describe.json.js').m;
		const safeBinaryReqs = {
			f: 's',
			n: '2',
			v: 1
		};

		const resolver = new HalDependencyResolver();
		const arr = resolver._walkChain(fixedTestData, safeBinaryReqs);
		expect(arr).eql([]);
	});

	it('flag a module for update when out of version', function() {
		const fixedTestData = require('./../describes/fixed_describe.json.js').m;
		const systemPart2 = fixedTestData[2];

		const safeBinaryReqs = {
			f: 's',
			n: '2',
			v: systemPart2.v + 1
		};

		const shouldBeMissing = { ...fixedTestData[2], v: systemPart2.v + 1, d: [] };

		const resolver = new HalDependencyResolver();
		const arr = resolver._walkChain(fixedTestData, safeBinaryReqs);
		expect(arr.length).eql(1);
		expect(arr[0]).eql(shouldBeMissing);
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
	it('passes a full test', async function() {

		const resolver = new HalDependencyResolver();

		const part1 = path.join(settings.binaries, '../binaries/040_system-part1.bin');
		const part2 = path.join(settings.binaries, '../binaries/040_system-part2.bin');

		// load those modules in!
		await resolver.assimilateModule(part1);
		await resolver.assimilateModule(part2);


		const describeFilename = path.join(settings.binaries, '../describes/old_describe.json.js');
		const oldDescribe = require(describeFilename).m;

		const userFirmware = path.join(settings.binaries, '../binaries/040_user-part.bin');
		const fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		const result = await resolver.parseAndResolve(oldDescribe, fileBuffer);

		expect(result).be.ok;
		console.log('dependency resolve result had ', result.length, ' items ');
		expect(result.length).eql(2);

		//the first thing should be part1, and the second thing part2

		expect(result[0].filename).to.match(/system-part1\.bin$/);
		expect(result[1].filename).to.match(/system-part2\.bin$/);
	});

	it('recommend modules when going from 042 to 043', async function() {

		const resolver = new HalDependencyResolver();

		const part1 = path.join(settings.binaries, '../binaries/043_system-part1.bin');
		const part2 = path.join(settings.binaries, '../binaries/043_system-part2.bin');

		// load those modules in!
		await resolver.assimilateModule(part1);
		await resolver.assimilateModule(part2);


		const describeFilename = path.join(settings.binaries, '../describes/042_describe.json.js');
		const oldDescribe = require(describeFilename).m;

		const userFirmware = path.join(settings.binaries, '../binaries/043_user-part.bin');
		const fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		const result = await resolver.parseAndResolve(oldDescribe, fileBuffer);

		expect(result).be.ok;
		console.log('dependency resolve result had ', result.length, ' items ');
		expect(result.length).eql(2);

		//the first thing should be part1, and the second thing part2

		expect(result[0].filename).to.match(/system-part1\.bin$/);
		expect(result[1].filename).to.match(/system-part2\.bin$/);
	});

	it('rejects when detects missing dependencies', async function(){
		const userModuleSafeMode = require('./../describes/safe_mode_2.json.js');
		const resolver = new HalDependencyResolver();

		const deps = resolver.findAnyMissingDependencies(userModuleSafeMode);
		expect(deps).be.ok;
		expect(deps.length).eql(1);
		expect(deps[0].f).eql('s');
		expect(deps[0].n).eql('2');
		expect(deps[0].v).eql(8);

		try {
			await resolver.userModuleHasMissingDependencies(userModuleSafeMode);
			new Error("Should have rejected: " + result);
		} catch (err) {
			console.log('!!!!!!!got error as expected', err)
			expect(err).be.ok;
			expect(err.length).eql(1);

			// show me the module that needs replacing!
			expect(err[0].func).to.eql('s');
			expect(err[0].name).to.eql('2');
			expect(err[0].version).to.eql(8);
		}
	});

	it('resolves when dependencies are met', async function(){
		const data = require('./../describes/fixed_dependencies_describe.json.js');
		const resolver = new HalDependencyResolver();


		const deps = resolver.findAnyMissingDependencies(data);
		expect(deps).be.ok;
		expect(deps.length).eql(0);

		return resolver.userModuleHasMissingDependencies(data);
	});

	it('solves firmware module', function(){
		const data = require('./../describes/fixed_dependencies_describe.json.js');
		const resolver = new HalDependencyResolver();
		const module = new FirmwareModule({
			d: [
				{
					f: 's',
					n: '2',
					v: 2
				}
			]
		});

		let result = resolver.solveFirmwareModule(data.m, module.dependencies[0]);
		expect(result).to.eql([]);

		const requiredVersion = 5;
		module.dependencies[0].version = requiredVersion;
		result = resolver.solveFirmwareModule(data.m, module.dependencies[0]);
		expect(result.length).to.eql(1);
		expect(result[0].v).to.eql(requiredVersion);
	});

	it('finds missing dependencies for example 1', async function() {
		const data = require('./../describes/safe_mode_1.json.js');
		const resolver = new HalDependencyResolver();
		const results = resolver.findAnyMissingDependencies(data);

		expect(results).be.ok;
		expect(results.length).be.greaterThan(0);

		const shouldBeMissing = data.m[2].d[0];
		const dep = results[0];


		//[ { s: 262144, l: 'm', vc: 30, vv: 30, f: 's', n: '1', v: 6, d: [] } ]
		expect(dep.f).eql(shouldBeMissing.f);
		expect(dep.n).eql(shouldBeMissing.n);
		expect(dep.v).eql(shouldBeMissing.v);
	});


	/**
	 * userModuleHasMissingDependencies should resolve if "monolithic describe" (missing user module)
	 */
	it('handles missing user module appropriately', async function() {

		const describe = require('./../describes/describe_no_usermodule.js');
		const resolver = new HalDependencyResolver();


		// should have nothing missing
		const deps = resolver.findAnyMissingDependencies(describe);
		expect(deps).be.ok;
		expect(deps.length).eql(0);

		// should resolve
		return resolver.userModuleHasMissingDependencies(describe);
	});

	/**
	 * userModuleHasMissingDependencies should resolve if "monolithic describe" (missing user module)
	 */
	it('handles missing user module with missing stuff appropriately', async function() {

		const describe = require('./../describes/describe_no_usermodule2.js');
		const resolver = new HalDependencyResolver();


		// should have nothing missing
		const deps = resolver.findAnyMissingDependencies(describe);
		expect(deps).be.ok;
		expect(deps.length).eql(1);

		expect(deps[0].f).eql('s');
		expect(deps[0].n).eql('1');
		expect(deps[0].v).eql(3);

		// should resolve without finding anything, because this describe has no usermodule.
		return resolver.userModuleHasMissingDependencies(describe);
	});

	it('handles weird double-safe-mode case', async function() {

		const describe = require('./../describes/safe_mode_3.json.js');
		const resolver = new HalDependencyResolver();


		// should have nothing missing
		const deps = resolver.findAnyMissingDependencies(describe);
		expect(deps).be.ok;
		expect(deps.length).eql(2);

		// since we're processing the modules in listed order, and since I think
		// they're also sorta in dependency order (part1 comes before part2), I think we're okay here.
		// there is a small risk of getting into a scenario where we keep trying to update part2,
		// instead of first sending part1.

		// so when picking an update in the case of multiple dependencies, we should pick the thing that
		// itself has no dependencies if available.

	});

	it('handles multiple dependencies', async function() {

		const describe = require('./../describes/multiple_dependencies.json.js');
		const resolver = new HalDependencyResolver();


		const deps = resolver.findAnyMissingDependencies(describe);
		expect(deps).be.ok;
		expect(deps.length).eql(1);

		// The missing dependency is a bootloader
		const m = describe.m[2].d[1];
		expect(deps[0].f).eql(m.f);
		expect(deps[0].n).eql(m.n);
		expect(deps[0].v).eql(m.v);
	});


	describe('factory image', () => {
		function hasMissingDependencies(describe) {
			const modules = new HalDependencyResolver().findAnyMissingDependencies(describe);
			return modules && modules.length > 0;
		}

		it('does not report safe mode for factory modules that are invalid', () => {

			const describe = { 'p':13,'m':[{ 's':49152,'l':'m','vc':30,'vv':30,'f':'b','n':'0','v':300,'d':[] },{ 's':671744,'l':'m','vc':30,'vv':30,'f':'s','n':'1','v':403,'d':[{ 'f':'b','n':'0','v':101,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'m','vc':30,'vv':30,'u':'09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45','f':'u','n':'1','v':5,'d':[{ 'f':'s','n':'1','v':403,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'f','vc':30,'vv':0,'d':[{ 'f':'_','n':'6','v':0,'_':'' },{ 'f':'_','n':'6','v':0,'_':'' }] }] };

			expect(hasMissingDependencies(describe)).to.be.eql(false);
		});

		it('does not report safe mode for factory modules that are invalid', () => {

			const describe = { 'p':13,'m':[{ 's':49152,'l':'m','vc':30,'vv':30,'f':'b','n':'0','v':300,'d':[] },{ 's':671744,'l':'m','vc':30,'vv':30,'f':'s','n':'1','v':403,'d':[{ 'f':'b','n':'0','v':101,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'m','vc':30,'vv':30,'u':'09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45','f':'u','n':'1','v':5,'d':[{ 'f':'s','n':'1','v':403,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'f','vc':30,'vv':0,'d':[{ 'f':'_','n':'6','v':0,'_':'' },{ 'f':'_','n':'6','v':0,'_':'' }] }] };

			expect(hasMissingDependencies(describe)).to.be.eql(false);
		});

		it('does not report safe mode for factory modules that are valid', () => {

			const describe = { 'p':13,'m':[{ 's':49152,'l':'m','vc':30,'vv':30,'f':'b','n':'0','v':300,'d':[] },{ 's':671744,'l':'m','vc':30,'vv':30,'f':'s','n':'1','v':403,'d':[{ 'f':'b','n':'0','v':101,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'m','vc':30,'vv':30,'u':'09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45','f':'u','n':'1','v':5,'d':[{ 'f':'s','n':'1','v':403,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'f','vc':30,'vv':30,'d':[{ 'f':'_','n':'6','v':0,'_':'' },{ 'f':'_','n':'6','v':0,'_':'' }] }] };

			expect(hasMissingDependencies(describe)).to.be.eql(false);
		});


		it('does not report safe mode for no missing dependencies', () => {

			const describe = { 'p':13,'m':[{ 's':49152,'l':'m','vc':30,'vv':30,'f':'b','n':'0','v':300,'d':[] },{ 's':671744,'l':'m','vc':30,'vv':30,'f':'s','n':'1','v':403,'d':[{ 'f':'b','n':'0','v':101,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'m','vc':30,'vv':30,'u':'09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45','f':'u','n':'1','v':5,'d':[{ 'f':'s','n':'1','v':403,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] }] };

			expect(hasMissingDependencies(describe)).to.be.eql(false);
		});

		it('reports safe mode for missing application dependencies', () => {

			const describe = { 'p':13,'m':[{ 's':49152,'l':'m','vc':30,'vv':30,'f':'b','n':'0','v':300,'d':[] },{ 's':671744,'l':'m','vc':30,'vv':30,'f':'s','n':'1','v':403,'d':[{ 'f':'b','n':'0','v':101,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] },{ 's':131072,'l':'m','vc':30,'vv':30,'u':'09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45','f':'u','n':'1','v':5,'d':[{ 'f':'s','n':'1','v':9999,'_':'' },{ 'f':'n','n':'0','v':0,'_':'' }] }] };

			expect(hasMissingDependencies(describe)).to.be.eql(true);
		});

	});

});
