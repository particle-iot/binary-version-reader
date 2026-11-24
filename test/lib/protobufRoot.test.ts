import protobuf from 'protobufjs/minimal';
import { describe, expect, it } from 'vitest';

describe('protobuf definitions', () => {
	it('leave the shared protobufjs default root to other generated modules', async () => {
		const otherRoot = {} as protobuf.Root;
		protobuf.roots['default'] = otherRoot;

		const { encodeEnvVarsAsset } = await import('../../src/lib/moduleEncoding.js');
		await encodeEnvVarsAsset({ NAME: 'value' }, { hash: 'abcd', updatedAt: 5_000_000_001 });

		expect(protobuf.roots['default']).toBe(otherRoot);
		expect(otherRoot).toEqual({});
	});
});
