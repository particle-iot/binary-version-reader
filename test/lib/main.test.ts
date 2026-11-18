import { describe, it, expect } from 'vitest';
const main = require('../../main');
const limited = require('../../limited');
const moduleEncoding = require('../../lib/moduleEncoding');
const config = require('../../lib/config');

describe('main', () => {
	it('exports everything from moduleEncoding and config', () => {
		for (const [name, value] of Object.entries({ ...moduleEncoding, ...config })) {
			expect(main[name], name).to.equal(value);
		}
	});

	it('exports the same browser-safe modules from limited', () => {
		expect(limited).to.deep.equal({ HalModuleParser: main.HalModuleParser, ModuleInfo: main.ModuleInfo });
	});
});
