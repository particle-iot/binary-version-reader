/**
 * SAFE MODE payload!
 * describe payload from an 045 part 1, 047 part 2
 * needs a new part1 !
 * user app has no dependencies (saw this in the wild)
 */

module.exports = {
  "f": [],
  "v": {},
  "p": 6,
  "m": [
    { "s": 16384, "l": "m", "vc": 30, "vv": 30, "f": "b", "n": "0", "v": 4, "d": [] },
    { "s": 262144, "l": "m", "vc": 30, "vv": 30, "f": "s",
      "n": "1",
      "v": 6,
      "d": []
    },
    { "s": 262144, "l": "m", "vc": 30, "vv": 26, "f": "s",
      "n": "2",
      "v": 7,
      "d": [
        {
          "f": "s",
          "n": "1",
          "v": 7,
          "_": ""
        }
      ] },
    { "s": 131072, "l": "m", "vc": 30, "vv": 30, "f": "s", "n": "1", "v": 6, "d": [] },
    { "s": 131072, "l": "f", "vc": 30, "vv": 0, "d": [] }
  ]
};