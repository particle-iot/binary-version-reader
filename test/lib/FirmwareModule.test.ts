'use strict';
import { describe, it, expect } from 'vitest';

import { FirmwareModule } from '../../src/lib/FirmwareModule';
import { describeFixtures } from '../../src/lib/firmwareTestHelper';
import * as ModuleInfo from '../../src/lib/ModuleInfo';
import modules from '../describes/modules';

const fixedDependenciesDescribe = describeFixtures.fixedDependenciesDescribe();
const testModules = modules;

describe('FirmwareModule', function () {
	it('should parse describe message', function () {
		const message = testModules.message;
		const module = new FirmwareModule(message);
		expect(module.uuid).toEqual(message.u);
		expect(module.func).toEqual(message.f);
		expect(module.location).toEqual(message.l);
		expect(module.name).toEqual(message.n);
		expect(module.version).toEqual(message.v);
		expect(module.maxSize).toEqual(message.s);
		expect(module.validityCheck).toEqual(message.vc);
		expect(module.validityValues).toEqual(message.vv);
		expect(module.dependencies.length).toEqual(1);
		expect(module.dependencies[0]!).toBeInstanceOf(FirmwareModule);
		expect(module.dependencies[0]!.func).toEqual(message.d[0]!.f);
		expect(module.dependencies[0]!.name).toEqual(message.d[0]!.n);
		expect(module.dependencies[0]!.version).toEqual(message.d[0]!.v);

		// Check validation flags
		expect(module.isValid()).toEqual(true);
		expect(module.hasIntegrity()).toEqual(true);
		expect(module.areDependenciesValid()).toEqual(true);
		expect(module.isImageAddressInRange()).toEqual(true);
		expect(module.isImagePlatformValid()).toEqual(true);
		expect(module.isImageProductValid()).toEqual(false);
	});

	it('exposes module function characters indexed by function type', function () {
		const module = new FirmwareModule();
		expect(module.moduleFunctions).toBe(ModuleInfo.FunctionToChar);
		expect(module.moduleFunctions[ModuleInfo.FunctionType.SYSTEM_PART]).toBe('s');
	});

	it('should set validation flags', function () {
		let module = new FirmwareModule({
			vc: 62,
			vv: 60
		});

		expect(module.isValid()).toEqual(false);
		expect(module.hasIntegrity()).toEqual(false);

		module = new FirmwareModule({ vv: 58 });
		expect(module.areDependenciesValid()).toEqual(false);

		module = new FirmwareModule({ vv: 54 });
		expect(module.isImageAddressInRange()).toEqual(false);

		module = new FirmwareModule({ vv: 46 });
		expect(module.isImagePlatformValid()).toEqual(false);

		module = new FirmwareModule({ vv: 30 });
		expect(module.isImageProductValid()).toEqual(false);
	});

	it('checks each ModuleInfo.ValidationFlags bit', function () {
		const { INTEGRITY, DEPENDENCIES, RANGE, PLATFORM, PRODUCT } = ModuleInfo.ValidationFlags;
		const all = INTEGRITY | DEPENDENCIES | RANGE | PLATFORM | PRODUCT;
		let module = new FirmwareModule({
			vc: all,
			vv: all & ~INTEGRITY
		});

		expect(module.isValid()).toEqual(false);
		expect(module.hasIntegrity()).toEqual(false);

		module = new FirmwareModule({ vv: all & ~DEPENDENCIES });
		expect(module.areDependenciesValid()).toEqual(false);
		expect(module.hasIntegrity()).toEqual(true);

		module = new FirmwareModule({ vv: all & ~RANGE });
		expect(module.isImageAddressInRange()).toEqual(false);
		expect(module.areDependenciesValid()).toEqual(true);

		module = new FirmwareModule({ vv: all & ~PLATFORM });
		expect(module.isImagePlatformValid()).toEqual(false);
		expect(module.isImageAddressInRange()).toEqual(true);

		module = new FirmwareModule({ vv: all & ~PRODUCT });
		expect(module.isImageProductValid()).toEqual(false);
		expect(module.isImagePlatformValid()).toEqual(true);
	});

	it('should not parse null/undefined describe', function () {
		expect(new FirmwareModule(null).dependencies).toEqual([]);
		expect(new FirmwareModule(undefined).dependencies).toEqual([]);
	});

	it('should return describe like object', function () {
		const message = testModules.message;
		const module = new FirmwareModule(message);
		const describeMessage = module.toDescribe();
		expect(describeMessage).toMatchObject({
			u: message.u,
			f: message.f,
			l: message.l,
			n: message.n,
			v: message.v,
			s: message.s,
			vc: message.vc,
			vv: message.vv
		});
		expect(describeMessage.d).toMatchObject([{ f: 's', n: '2', v: 5, d: [] }]);
	});

	it('should return dependency resolution status', function () {
		const message = testModules.message;
		const module = new FirmwareModule(message);
		const data = fixedDependenciesDescribe;

		let unmet: FirmwareModule[] = [];
		let result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(false);
		expect(unmet).toHaveLength(1);

		module.dependencies[0]!.version = 2;

		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(true);
		expect(unmet).toHaveLength(0);
	});

	it('should return dependency resolution status for multiple dependencies', function () {
		const message = testModules.messageMultipleDependencies;
		const module = new FirmwareModule(message);

		const data = fixedDependenciesDescribe;

		let unmet: FirmwareModule[] = [];
		let result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(false);
		expect(unmet).toHaveLength(2);

		module.dependencies[0]!.version = 2;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(false);
		expect(unmet).toHaveLength(1);

		module.dependencies[1]!.version = 2;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(true);
		expect(unmet).toHaveLength(0);
	});

	it('should return dependency resolution status with module function "none"', function () {
		const message = testModules.messageMultipleDependencies;
		const module = new FirmwareModule(message);

		const data = fixedDependenciesDescribe;

		let unmet: FirmwareModule[] = [];
		let result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(false);
		expect(unmet).toHaveLength(2);

		module.dependencies[0]!.func = ModuleInfo.FunctionChar.NONE;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(false);
		expect(unmet).toHaveLength(1);

		module.dependencies[1]!.func = ModuleInfo.FunctionChar.NONE;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(true);
		expect(unmet).toHaveLength(0);
	});

	it('should return dependency resolution status when dependency is not present in device describe', function () {
		const message = testModules.messageWithDependencyNotInDeviceDescribe;
		const module = new FirmwareModule(message);

		const data = fixedDependenciesDescribe;

		const unmet: FirmwareModule[] = [];
		const result = module.areDependenciesMet(data.m, unmet);
		expect(result).toEqual(false);
		expect(unmet).toHaveLength(1);
	});
});
