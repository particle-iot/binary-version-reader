'use strict';
import * as fs from 'fs';
import * as path from 'path';

import { describe, it, expect, onTestFinished, vi } from 'vitest';

import { FirmwareModule } from '../../src/lib/FirmwareModule';
import { describeFixtures } from '../../src/lib/firmwareTestHelper';
import { HalDependencyResolver } from '../../src/lib/HalDependencyResolver';
import type { Describe } from '../../src/lib/HalDescribeParser';

const describe042 = describeFixtures.describe042();
const describeFixture = describeFixtures.describe();
const describeNoUsermodule = describeFixtures.describeNoUsermodule();
const describeNoUsermodule2 = describeFixtures.describeNoUsermodule2();
const fixedDependenciesDescribe = describeFixtures.fixedDependenciesDescribe();
const fixedDescribe = describeFixtures.fixedDescribe();
const multipleDependencies = describeFixtures.multipleDependencies();
const oldDescribeFixture = describeFixtures.oldDescribe();
const safeMode1 = describeFixtures.safeMode1();
const safeMode2 = describeFixtures.safeMode2();
const safeMode3 = describeFixtures.safeMode3();
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

const settings = {
	binaries: path.resolve(path.join(__dirname, '../binaries'))
};

function hasMissingDependencies(describeMessage: Describe) {
	const modules = new HalDependencyResolver().findAnyMissingDependencies(describeMessage);
	return modules && modules.length > 0;
}

describe('HalDependencyResolver', function () {
	it('logs and skips a module that fails to parse', async function () {
		const resolver = new HalDependencyResolver();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		onTestFinished(() => consoleError.mockRestore());
		await resolver.assimilateModule(path.join(settings.binaries, 'emptybin.bin'));
		expect(consoleError.mock.calls).toHaveLength(1);
		const [, error] = consoleError.mock.calls[0]!;
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain('was empty');
		expect(resolver._moduleStorage).toEqual([]);
	});

	it('repairs errors in module names and versions', function () {
		const photonReportedModules = describeFixture.m;
		const fixedTestData = fixedDescribe.m;

		const resolver = new HalDependencyResolver();
		const result = resolver._repairDescribeErrors(photonReportedModules);

		expect(result).toEqual(fixedTestData);
	});

	it('converts binary metadata into describe format', function () {
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

		expect(result).toEqual(expectedDescribe);
	});

	it('walk a dependency chain nicely', function () {
		const fixedTestData = fixedDescribe.m;
		const safeBinaryReqs = {
			f: 's',
			n: '2',
			v: 1
		};

		const resolver = new HalDependencyResolver();
		const arr = resolver._walkChain(fixedTestData, safeBinaryReqs);
		expect(arr).toEqual([]);
	});

	it('flag a module for update when out of version', function () {
		const fixedTestData = fixedDescribe.m;
		const systemPart2 = fixedTestData[2]!;
		const requiredVersion = systemPart2.v! + 1;

		const safeBinaryReqs = {
			f: 's',
			n: '2',
			v: requiredVersion
		};

		const shouldBeMissing = { ...systemPart2, v: requiredVersion, d: [] };

		const resolver = new HalDependencyResolver();
		const arr = resolver._walkChain(fixedTestData, safeBinaryReqs);
		expect(arr.length).toEqual(1);
		expect(arr[0]).toEqual(shouldBeMissing);
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
	it('passes a full test', async function () {
		const resolver = new HalDependencyResolver();

		const part1 = path.join(settings.binaries, '../binaries/040_system-part1.bin');
		const part2 = path.join(settings.binaries, '../binaries/040_system-part2.bin');

		// load those modules in!
		await resolver.assimilateModule(part1);
		await resolver.assimilateModule(part2);

		const oldDescribe = oldDescribeFixture.m;

		const userFirmware = path.join(settings.binaries, '../binaries/040_user-part.bin');
		const fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		const result = await resolver.parseAndResolve(oldDescribe, fileBuffer);

		expect(result).toBeTruthy();
		expect(result.length).toEqual(2);

		//the first thing should be part1, and the second thing part2

		expect(result[0]!.filename).toMatch(/system-part1\.bin$/);
		expect(result[1]!.filename).toMatch(/system-part2\.bin$/);
	});

	it('recommend modules when going from 042 to 043', async function () {
		const resolver = new HalDependencyResolver();

		const part1 = path.join(settings.binaries, '../binaries/043_system-part1.bin');
		const part2 = path.join(settings.binaries, '../binaries/043_system-part2.bin');

		// load those modules in!
		await resolver.assimilateModule(part1);
		await resolver.assimilateModule(part2);

		const oldDescribe = describe042.m;

		const userFirmware = path.join(settings.binaries, '../binaries/043_user-part.bin');
		const fileBuffer = fs.readFileSync(userFirmware);

		//
		// given a describe message from a device, and some user firmware, get the modules we need to run it.
		//
		const result = await resolver.parseAndResolve(oldDescribe, fileBuffer);

		expect(result).toBeTruthy();
		expect(result.length).toEqual(2);

		//the first thing should be part1, and the second thing part2

		expect(result[0]!.filename).toMatch(/system-part1\.bin$/);
		expect(result[1]!.filename).toMatch(/system-part2\.bin$/);
	});

	it('rejects when detects missing dependencies', async function () {
		const userModuleSafeMode = safeMode2;
		const resolver = new HalDependencyResolver();

		const deps = resolver.findAnyMissingDependencies(userModuleSafeMode)!;
		expect(deps).toBeTruthy();
		expect(deps.length).toEqual(1);
		expect(deps[0]!.f).toEqual('s');
		expect(deps[0]!.n).toEqual('2');
		expect(deps[0]!.v).toEqual(8);

		const err: FirmwareModule[] = await resolver.userModuleHasMissingDependencies(userModuleSafeMode).then(
			(result) => expect.fail(`Should have rejected: ${result}`),
			(error) => error
		);
		expect(err.length).toEqual(1);

		// show me the module that needs replacing!
		expect(err[0]!.func).toEqual('s');
		expect(err[0]!.name).toEqual('2');
		expect(err[0]!.version).toEqual(8);
	});

	it('resolves when dependencies are met', async function () {
		const data = fixedDependenciesDescribe;
		const resolver = new HalDependencyResolver();

		const deps = resolver.findAnyMissingDependencies(data)!;
		expect(deps).toBeTruthy();
		expect(deps.length).toEqual(0);

		return resolver.userModuleHasMissingDependencies(data);
	});

	it('solves firmware module', function () {
		const data = fixedDependenciesDescribe;
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

		let result = resolver.solveFirmwareModule(data.m, module.dependencies[0]!);
		expect(result).toEqual([]);

		const requiredVersion = 5;
		module.dependencies[0]!.version = requiredVersion;
		result = resolver.solveFirmwareModule(data.m, module.dependencies[0]!);
		expect(result.length).toEqual(1);
		expect(result[0]!.v).toEqual(requiredVersion);
	});

	it('finds missing dependencies for example 1', async function () {
		const data = safeMode1;
		const resolver = new HalDependencyResolver();
		const results = resolver.findAnyMissingDependencies(data)!;

		expect(results).toBeTruthy();
		expect(results.length).toBeGreaterThan(0);

		const shouldBeMissing = data.m[2]!.d![0]!;
		const dep = results[0]!;

		//[ { s: 262144, l: 'm', vc: 30, vv: 30, f: 's', n: '1', v: 6, d: [] } ]
		expect(dep.f).toEqual(shouldBeMissing.f);
		expect(dep.n).toEqual(shouldBeMissing.n);
		expect(dep.v).toEqual(shouldBeMissing.v);
	});

	/**
	 * userModuleHasMissingDependencies should resolve if "monolithic describe" (missing user module)
	 */
	it('handles missing user module appropriately', async function () {
		const describeMessage = describeNoUsermodule;
		const resolver = new HalDependencyResolver();

		// should have nothing missing
		const deps = resolver.findAnyMissingDependencies(describeMessage)!;
		expect(deps).toBeTruthy();
		expect(deps.length).toEqual(0);

		// should resolve
		return resolver.userModuleHasMissingDependencies(describeMessage);
	});

	/**
	 * userModuleHasMissingDependencies should resolve if "monolithic describe" (missing user module)
	 */
	it('handles missing user module with missing stuff appropriately', async function () {
		const describeMessage = describeNoUsermodule2;
		const resolver = new HalDependencyResolver();

		// should have nothing missing
		const deps = resolver.findAnyMissingDependencies(describeMessage)!;
		expect(deps).toBeTruthy();
		expect(deps.length).toEqual(1);

		expect(deps[0]!.f).toEqual('s');
		expect(deps[0]!.n).toEqual('1');
		expect(deps[0]!.v).toEqual(3);

		// should resolve without finding anything, because this describe has no usermodule.
		return resolver.userModuleHasMissingDependencies(describeMessage);
	});

	it('handles weird double-safe-mode case', async function () {
		const describeMessage = safeMode3;
		const resolver = new HalDependencyResolver();

		// should have nothing missing
		const deps = resolver.findAnyMissingDependencies(describeMessage)!;
		expect(deps).toBeTruthy();
		expect(deps.length).toEqual(2);

		// since we're processing the modules in listed order, and since I think
		// they're also sorta in dependency order (part1 comes before part2), I think we're okay here.
		// there is a small risk of getting into a scenario where we keep trying to update part2,
		// instead of first sending part1.

		// so when picking an update in the case of multiple dependencies, we should pick the thing that
		// itself has no dependencies if available.
	});

	it('handles multiple dependencies', async function () {
		const describeMessage = multipleDependencies;
		const resolver = new HalDependencyResolver();

		const deps = resolver.findAnyMissingDependencies(describeMessage)!;
		expect(deps).toBeTruthy();
		expect(deps.length).toEqual(1);

		// The missing dependency is a bootloader
		const m = describeMessage.m[2]!.d![1]!;
		expect(deps[0]!.f).toEqual(m.f);
		expect(deps[0]!.n).toEqual(m.n);
		expect(deps[0]!.v).toEqual(m.v);
	});

	describe('factory image', () => {
		it('does not report safe mode for factory modules that are invalid', () => {
			const describeMessage = {
				p: 13,
				m: [
					{ s: 49152, l: 'm', vc: 30, vv: 30, f: 'b', n: '0', v: 300, d: [] },
					{
						s: 671744,
						l: 'm',
						vc: 30,
						vv: 30,
						f: 's',
						n: '1',
						v: 403,
						d: [
							{ f: 'b', n: '0', v: 101, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'm',
						vc: 30,
						vv: 30,
						u: '09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45',
						f: 'u',
						n: '1',
						v: 5,
						d: [
							{ f: 's', n: '1', v: 403, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'f',
						vc: 30,
						vv: 0,
						d: [
							{ f: '_', n: '6', v: 0, _: '' },
							{ f: '_', n: '6', v: 0, _: '' }
						]
					}
				]
			};

			expect(hasMissingDependencies(describeMessage)).toEqual(false);
		});

		it('does not report safe mode for factory modules that are invalid', () => {
			const describeMessage = {
				p: 13,
				m: [
					{ s: 49152, l: 'm', vc: 30, vv: 30, f: 'b', n: '0', v: 300, d: [] },
					{
						s: 671744,
						l: 'm',
						vc: 30,
						vv: 30,
						f: 's',
						n: '1',
						v: 403,
						d: [
							{ f: 'b', n: '0', v: 101, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'm',
						vc: 30,
						vv: 30,
						u: '09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45',
						f: 'u',
						n: '1',
						v: 5,
						d: [
							{ f: 's', n: '1', v: 403, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'f',
						vc: 30,
						vv: 0,
						d: [
							{ f: '_', n: '6', v: 0, _: '' },
							{ f: '_', n: '6', v: 0, _: '' }
						]
					}
				]
			};

			expect(hasMissingDependencies(describeMessage)).toEqual(false);
		});

		it('does not report safe mode for factory modules that are valid', () => {
			const describeMessage = {
				p: 13,
				m: [
					{ s: 49152, l: 'm', vc: 30, vv: 30, f: 'b', n: '0', v: 300, d: [] },
					{
						s: 671744,
						l: 'm',
						vc: 30,
						vv: 30,
						f: 's',
						n: '1',
						v: 403,
						d: [
							{ f: 'b', n: '0', v: 101, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'm',
						vc: 30,
						vv: 30,
						u: '09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45',
						f: 'u',
						n: '1',
						v: 5,
						d: [
							{ f: 's', n: '1', v: 403, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'f',
						vc: 30,
						vv: 30,
						d: [
							{ f: '_', n: '6', v: 0, _: '' },
							{ f: '_', n: '6', v: 0, _: '' }
						]
					}
				]
			};

			expect(hasMissingDependencies(describeMessage)).toEqual(false);
		});

		it('does not report safe mode for no missing dependencies', () => {
			const describeMessage = {
				p: 13,
				m: [
					{ s: 49152, l: 'm', vc: 30, vv: 30, f: 'b', n: '0', v: 300, d: [] },
					{
						s: 671744,
						l: 'm',
						vc: 30,
						vv: 30,
						f: 's',
						n: '1',
						v: 403,
						d: [
							{ f: 'b', n: '0', v: 101, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'm',
						vc: 30,
						vv: 30,
						u: '09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45',
						f: 'u',
						n: '1',
						v: 5,
						d: [
							{ f: 's', n: '1', v: 403, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					}
				]
			};

			expect(hasMissingDependencies(describeMessage)).toEqual(false);
		});

		it('reports safe mode for missing application dependencies', () => {
			const describeMessage = {
				p: 13,
				m: [
					{ s: 49152, l: 'm', vc: 30, vv: 30, f: 'b', n: '0', v: 300, d: [] },
					{
						s: 671744,
						l: 'm',
						vc: 30,
						vv: 30,
						f: 's',
						n: '1',
						v: 403,
						d: [
							{ f: 'b', n: '0', v: 101, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					},
					{
						s: 131072,
						l: 'm',
						vc: 30,
						vv: 30,
						u: '09B7930F35B990D0021501E62007AE48BBC68E6422CE4504B2BA6DEA7F5E1C45',
						f: 'u',
						n: '1',
						v: 5,
						d: [
							{ f: 's', n: '1', v: 9999, _: '' },
							{ f: 'n', n: '0', v: 0, _: '' }
						]
					}
				]
			};

			expect(hasMissingDependencies(describeMessage)).toEqual(true);
		});
	});
});
