'use strict';
import { describe, it, expect } from 'vitest';

import * as firmwareTestHelper from '../../src/lib/firmwareTestHelper';
import { HalModuleParser } from '../../src/lib/HalModuleParser';
import * as ModuleInfo from '../../src/lib/ModuleInfo';

describe('firmwareTestHelper', function () {
	describe('createFirmwareBinary', function () {
		it('creates a valid user part', async function () {
			const productId = 42;
			const productVersion = 3;
			const platformId = 6;
			const depModuleVersion = 1234;
			const deps = [
				{
					func: ModuleInfo.FunctionType.SYSTEM_PART,
					index: 1,
					version: depModuleVersion
				}
			];

			const binary = firmwareTestHelper.createFirmwareBinary({ productId, productVersion, platformId, deps });

			const fileInfo = await new HalModuleParser().parseBuffer({ fileBuffer: binary });
			{
				expect(fileInfo).toBeTruthy();
				expect(fileInfo.prefixInfo.platformID).toEqual(platformId);
				expect(fileInfo.prefixInfo.depModuleVersion).toEqual(depModuleVersion);
				expect(fileInfo.prefixInfo.prefixOffset).toEqual(0); // No vector table by default
				expect(fileInfo.suffixInfo.productId).toEqual(productId);
				expect(fileInfo.suffixInfo.productVersion).toEqual(productVersion);
			}
		});

		it('can optionally create a module with a vector table', async function () {
			const productId = 42;
			const productVersion = 3;
			const platformId = 6;
			const depModuleVersion = 1234;
			const deps = [
				{
					func: ModuleInfo.FunctionType.SYSTEM_PART,
					index: 1,
					version: depModuleVersion
				}
			];

			const binary = firmwareTestHelper.createFirmwareBinary({
				productId,
				productVersion,
				platformId,
				deps,
				addVectorTable: true
			});

			const fileInfo = await new HalModuleParser().parseBuffer({ fileBuffer: binary });
			{
				expect(fileInfo).toBeTruthy();
				expect(fileInfo.prefixInfo.platformID).toEqual(platformId);
				expect(fileInfo.prefixInfo.depModuleVersion).toEqual(depModuleVersion);
				expect(fileInfo.prefixInfo.prefixOffset).toBeGreaterThan(0);
				expect(fileInfo.suffixInfo.productId).toEqual(productId);
				expect(fileInfo.suffixInfo.productVersion).toEqual(productVersion);
			}
		});
	});
});
