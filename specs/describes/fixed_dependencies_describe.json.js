/**
 * describe payload from an 042 photon with met dependencies
 */

module.exports = {
	m: [
		{ s: 16384, l: 'm', vc: 30, vv: 30, f: 'b', n: '0', v: 3, d: [] },
		{ s: 262144, l: 'm', vc: 30, vv: 30, f: 's', n: '1', v: 2, d: [] },
		{ s: 262144, l: 'm', vc: 30, vv: 30, f: 's', n: '2', v: 2, d: [
			{ f: 's', n: '1', v: 2, _: '' }
		] },
		{ s: 131072, l: 'm', vc: 30, vv: 30, u: '2BA4E71E840F596B812003882AAE7CA6496F1590CA4A049310AF76EAF11C943A', f: 'u', n: '1', v: 2, d: [
			{ f: 's', n: '2', v: 2, _: '' }
		] },
		{ s: 131072, l: 'f', vc: 30, vv: 0, d: [] }
	]
};
