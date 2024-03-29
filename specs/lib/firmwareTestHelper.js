'use strict';
const expect = require('chai').expect;
const firmwareTestHelper = require('../../lib/firmwareTestHelper');
const HalModuleParser = require('../../lib/HalModuleParser');
const ModuleInfo = require('../../lib/ModuleInfo');

describe('firmwareTestHelper', function() {
	describe('createFirmwareBinary', function() {
		it('creates a valid user part', function() {
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

			const parser = new HalModuleParser();
			return parser.parseBuffer({ fileBuffer: binary }).then((fileInfo) => {
				expect(fileInfo).to.be.ok;
				expect(fileInfo.prefixInfo.platformID).to.eql(platformId);
				expect(fileInfo.prefixInfo.depModuleVersion).to.eql(depModuleVersion);
				expect(fileInfo.prefixInfo.prefixOffset).to.eql(0); // No vector table by default
				expect(fileInfo.suffixInfo.productId).to.eql(productId);
				expect(fileInfo.suffixInfo.productVersion).to.eql(productVersion);
			});
		});

		it('can optionally create a module with a vector table', function() {
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

			const binary = firmwareTestHelper.createFirmwareBinary({ productId, productVersion, platformId, deps,
					addVectorTable: true });

			const parser = new HalModuleParser();
			return parser.parseBuffer({ fileBuffer: binary }).then((fileInfo) => {
				expect(fileInfo).to.be.ok;
				expect(fileInfo.prefixInfo.platformID).to.eql(platformId);
				expect(fileInfo.prefixInfo.depModuleVersion).to.eql(depModuleVersion);
				expect(fileInfo.prefixInfo.prefixOffset).to.be.greaterThan(0);
				expect(fileInfo.suffixInfo.productId).to.eql(productId);
				expect(fileInfo.suffixInfo.productVersion).to.eql(productVersion);
			});
		});
	});
});
