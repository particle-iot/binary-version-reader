/**
 * SAFE MODE payload!
 *
 * in this case we're running 047 or whatever, but BOTH part 2, and the user app need updates
 *
 */

module.exports = {
  "f": [],
  "v": {},
  "p": 6,
  "m": [
    { "s": 16384, "l": "m", "vc": 30, "vv": 30, "f": "b", "n": "0", "v": 4, "d": [] },
    { "s": 262144, "l": "m", "vc": 30, "vv": 30, "f": "s",
      "n": "1",
      "v": 7,
      "d": []
    },
    { "s": 262144, "l": "m", "vc": 30, "vv": 26, "f": "s",
      "n": "2",
      "v": 7,
      "d": [
        {
          "f": "s",
          "n": "1",
          "v": 8,
          "_": ""
        }
      ]
	},
    {
		"s": 131072,
		"l": "m",
		"vc": 30,
		"vv": 30,
		f: "u",
		"n": "1",
		"v": 6,
		"d": [
        {
          "f": "s",
          "n": "2",
          "v": 8,
          "_": ""
        }
      ]
	},
    { "s": 131072, "l": "f", "vc": 30, "vv": 0, "d": [] }
  ]
};