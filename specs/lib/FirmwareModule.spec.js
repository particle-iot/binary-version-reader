'use strict';
import { describe, it, expect } from 'vitest';
const FirmwareModule = require('../../lib/FirmwareModule');
const ModuleInfo = require('../../lib/ModuleInfo');
const testModules = require('./../describes/modules.json.js');

describe('FirmwareModule', function(){
	it('should parse describe message', function(){
		const message = testModules.message;
		const module = new FirmwareModule(message);
		expect(module.uuid).to.eql(message.u);
		expect(module.func).to.eql(message.f);
		expect(module.location).to.eql(message.l);
		expect(module.name).to.eql(message.n);
		expect(module.version).to.eql(message.v);
		expect(module.maxSize).to.eql(message.s);
		expect(module.validityCheck).to.eql(message.vc);
		expect(module.validityValues).to.eql(message.vv);
		expect(module.dependencies.length).to.eql(1);
		expect(module.dependencies[0]).to.be.an.instanceOf(FirmwareModule);
		expect(module.dependencies[0].func).to.eql(message.d[0].f);
		expect(module.dependencies[0].name).to.eql(message.d[0].n);
		expect(module.dependencies[0].version).to.eql(message.d[0].v);

		// Check validation flags
		expect(module.isValid()).to.eql(true);
		expect(module.hasIntegrity()).to.eql(true);
		expect(module.areDependenciesValid()).to.be.eql(true);
		expect(module.isImageAddressInRange()).to.be.eql(true);
		expect(module.isImagePlatformValid()).to.be.eql(true);
		expect(module.isImageProductValid()).to.eql(false);
	});

	it('should set validation flags', function(){
		let module = new FirmwareModule({
			vc: 62,
			vv: 60
		});

		expect(module.isValid()).to.eql(false);
		expect(module.hasIntegrity()).to.eql(false);

		module = new FirmwareModule({ vv: 58 });
		expect(module.areDependenciesValid()).to.eql(false);

		module = new FirmwareModule({ vv: 54 });
		expect(module.isImageAddressInRange()).to.eql(false);

		module = new FirmwareModule({ vv: 46 });
		expect(module.isImagePlatformValid()).to.eql(false);

		module = new FirmwareModule({ vv: 30 });
		expect(module.isImageProductValid()).to.eql(false);
	});

	it('should not parse null/undefined describe', function(){
		let module = new FirmwareModule(null);
		module = new FirmwareModule(undefined);
	});

	it('should return describe like object', function(){
		const message = testModules.message;
		const module = new FirmwareModule(message);
		const describe = module.toDescribe();
		expect(describe.u).to.eql(describe.u);
		expect(describe.f).to.eql(describe.f);
		expect(describe.l).to.eql(describe.l);
		expect(describe.n).to.eql(describe.n);
		expect(describe.v).to.eql(describe.v);
		expect(describe.s).to.eql(describe.s);
		expect(describe.vc).to.eql(describe.vc);
		expect(describe.vv).to.eql(describe.vv);
		expect(describe.d).to.eql(describe.d);
	});

	it('should return dependency resolution status', function(){
		const message = testModules.message;
		const module = new FirmwareModule(message);
		const data = require('./../describes/fixed_dependencies_describe.json.js');

		let unmet = [];
		let result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(false);
		expect(unmet).to.have.lengthOf(1);

		module.dependencies[0].version = 2;

		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(true);
		expect(unmet).to.have.lengthOf(0);
	});

	it('should return dependency resolution status for multiple dependencies', function(){
		const message = testModules.messageMultipleDependencies;
		const module = new FirmwareModule(message);

		const data = require('./../describes/fixed_dependencies_describe.json.js');

		let unmet = [];
		let result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(false);
		expect(unmet).to.have.lengthOf(2);

		module.dependencies[0].version = 2;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(false);
		expect(unmet).to.have.lengthOf(1);

		module.dependencies[1].version = 2;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(true);
		expect(unmet).to.have.lengthOf(0);
	});

	it('should return dependency resolution status with module function "none"', function(){
		const message = testModules.messageMultipleDependencies;
		const module = new FirmwareModule(message);

		const data = require('./../describes/fixed_dependencies_describe.json.js');

		let unmet = [];
		let result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(false);
		expect(unmet).to.have.lengthOf(2);

		module.dependencies[0].func = ModuleInfo.FunctionChar.NONE;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(false);
		expect(unmet).to.have.lengthOf(1);

		module.dependencies[1].func = ModuleInfo.FunctionChar.NONE;
		unmet = [];
		result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(true);
		expect(unmet).to.have.lengthOf(0);
	});

	it('should return dependency resolution status when dependency is not present in device describe', function(){
		const message = testModules.messageWithDependencyNotInDeviceDescribe;
		const module = new FirmwareModule(message);

		const data = require('./../describes/fixed_dependencies_describe.json.js');

		const unmet = [];
		const result = module.areDependenciesMet(data.m, unmet);
		expect(result).to.eql(false);
		expect(unmet).to.have.lengthOf(1);
	});
});
