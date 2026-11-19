import { describe, it, expect } from 'vitest';

import { FirmwareModule } from '../../src/lib/FirmwareModule';
import { describeFixtures } from '../../src/lib/firmwareTestHelper';
import { HalDescribeParser } from '../../src/lib/HalDescribeParser';

const fixedDependenciesDescribe = describeFixtures.fixedDependenciesDescribe();
const safeMode1 = describeFixtures.safeMode1();
const threeSystemModules = describeFixtures.threeSystemModules();
const threeSystemModulesWithFirmwareReset = describeFixtures.threeSystemModulesWithFirmwareReset();
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

describe('Describe parser', function () {
	describe('getModules', function () {
		it('returns null when describe is incorrect', function () {
			const parser = new HalDescribeParser();
			expect(parser.getModules()).toBeNull();
			expect(parser.getModules({})).toBeNull();
			// @ts-expect-error an invalid module list is rejected at runtime
			expect(parser.getModules({ m: 'foo' })).toBeNull();
		});

		it('returns FirmwareModules from describe', function () {
			const data = fixedDependenciesDescribe;
			const parser = new HalDescribeParser();
			const results = parser.getModules(data);
			expect(results).toHaveLength(5);
			expect(results?.[0] instanceof FirmwareModule).toBe(true);
		});
	});

	describe('getSystemVersion', function () {
		it('returns null when describe is incorrect', function () {
			const parser = new HalDescribeParser();
			expect(parser.getSystemVersion()).toBeNull();
		});

		it('returns first system module version', function () {
			const data = safeMode1;
			const parser = new HalDescribeParser();
			expect(parser.getSystemVersion(data)).toBe(6);
		});

		it('returns system version for three modules', function () {
			const data = threeSystemModules;
			const parser = new HalDescribeParser();
			expect(parser.getSystemVersion(data)).toBe(19);
		});

		it('works with three modules and firmware reset', function () {
			const data = threeSystemModulesWithFirmwareReset;
			const parser = new HalDescribeParser();
			expect(parser.getSystemVersion(data)).toBe(202);
			const modules = parser.getModules(data);
			const restoreModule = modules!.find((module) => module.isFactoryLocation());
			expect(restoreModule).toBeDefined();
			expect(restoreModule?.version).toBe(3);
		});
	});
});
