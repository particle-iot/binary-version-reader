import { describe, it, expect } from 'vitest';

import * as config from '../../src/lib/config';
import * as moduleEncoding from '../../src/lib/moduleEncoding';
import * as limited from '../../src/limited';
import * as main from '../../src/main';

describe('main', () => {
	it('exports everything from moduleEncoding and config', () => {
		expect(main).toMatchObject({ ...moduleEncoding, ...config });
	});

	it('exports the same browser-safe modules from limited', () => {
		expect({ ...limited }).toEqual({ HalModuleParser: main.HalModuleParser, ModuleInfo: main.ModuleInfo });
	});
});
