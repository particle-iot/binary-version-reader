var should = require('should');
var FirmwareModule = require('../../lib/FirmwareModule');

describe('FirmwareModule', function(){
	it('should parse describe message', function(){
		var message = {
			s: 131072,
			l: "m",
			vc: 30,
			vv: 30,
			u: "7F2F2B5C5A4F40D9844D109B7FBD730BF2237C252EF03ED5075CEB9901AF985E",
			f: "u",
			n: "1",
			v: 3,
			d: [
				{
					f: "s",
					n: "2",
					v: 5,
					_: ""
				}
			]
		};
		var module = new FirmwareModule(message);
		module.uuid.should.eql(message.u);
		module.func.should.eql(message.f);
		module.location.should.eql(message.l);
		module.name.should.eql(message.n);
		module.version.should.eql(message.v);
		module.maxSize.should.eql(message.s);
		module.validityCheck.should.eql(message.vc);
		module.validityValues.should.eql(message.vv);
		module.dependencies.length.should.eql(1);
		module.dependencies[0].should.be.an.instanceOf(FirmwareModule);
		module.dependencies[0].func.should.eql(message.d[0].f);
		module.dependencies[0].name.should.eql(message.d[0].n);
		module.dependencies[0].version.should.eql(message.d[0].v);

		// Check validation flags
		module.isValid().should.eql(true);
		module.hasIntegrity().should.eql(true);
		module.areDependenciesValid().should.be.eql(true);
		module.isImageAddressInRange().should.be.eql(true);
		module.isImagePlatformValid().should.be.eql(true);
		module.isImageProductValid().should.eql(false);
	});

	it('should set validation flags', function(){
		var module = new FirmwareModule({
			vc: 62,
			vv: 60
		});

		module.isValid().should.eql(false);
		module.hasIntegrity().should.eql(false);

		module = new FirmwareModule({ vv: 58 });
		module.areDependenciesValid().should.eql(false);

		module = new FirmwareModule({ vv: 54 });
		module.isImageAddressInRange().should.eql(false);

		module = new FirmwareModule({ vv: 46 });
		module.isImagePlatformValid().should.eql(false);

		module = new FirmwareModule({ vv: 30 });
		module.isImageProductValid().should.eql(false);
	});

	it('should not parse null/undefined describe', function(){
		var module = new FirmwareModule(null);
		module = new FirmwareModule(undefined);
	});
});
