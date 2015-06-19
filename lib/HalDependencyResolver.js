/**
 * Created by middleca on 6/18/15.
 */


var path = require("path");
var should = require("should");
var when = require('when');
var pipeline = require('when/pipeline');

var HalModuleParser = require('./HalModuleParser.js');


var HalDependencyResolver = function() {

};
HalDependencyResolver.prototype = {

	parse_and_solve: function(describe, fileBuffer) {
		var parser = new HalModuleParser();
		var fileInfo = {
			fileBuffer: fileBuffer
		};

		var that = this;
		return pipeline([
			function() {
				return parser.parseBuffer(fileInfo);
			},
			function() {
				console.log("got fileInfo ", fileInfo);
				return that.solve(describe, fileInfo);
			}
		]);
	},

	solve: function(describe_info, binary_info) {

	},

	/**
	 * for modules in 'location:main'
	 * not for user modules 'function:user'
	 *
	 * for modules with 'function:system' or 'function:bootloader'
	 *
	 * fix the array so that 'n' is ascending "0", "1", "2" ...
	 * set any missing version to 'version:0'
	 * set missing function to 'function:system'
	 *
	 *
	 * @param describe_info
	 */
	repairDescribeErrors: function(describe_info) {
		var arr = describe_info;


		//we're assuming the modules are in the reported order, which should be dependency order.

		// essentially we're looking to add this to the correct module:
		//	f: "s", n: "1", v: 1,

		for(var i = 0; i < arr.length; i++) {
			var item = arr[i];

			if (item.l != "m") {
				//not stored in main
				continue;
			}
			else if (item.f == "u") {
				//I'm a user module, bail
				break;
			}

			// are we the first thing and we don't have a name?
			if ((i == 0) && (!item.n)) {
				item.n = i + "";
			}

			//skip the first one.
			if (i == 0) {
				continue;
			}

			// i is at least 1
			var lastItem = arr[i - 1];
			//var nextOne = ((i+1) < arr.length) ? arr[i+1] : null;

			if (lastItem.n && !item.n) {
				//last one had a name, and I don't have a name.
				item.n = (parseInt(lastItem.n) + 1) + "";

				if (!item.f) {
					// was missing a function designation
					item.f = "s";
				}
				if (!item.v) {
					// was missing a version number
					item.v = 0;
				}
			}
		}
		return describe_info;
	},


	/**
	 * the binary prefix contains a numeric value for its dependent module function
	 * convert that number into the same characters reported by the photon (s, u, b, etc)
	 *
	 * @param moduleFunction
	 * @returns {*}
	 * @private
	 */
	_mod_func_to_char: function(moduleFunction) {
		var result;

		//var moduleFunctions = [ "system" | "user" | "boot" | "res" | "mono" ];

		switch (moduleFunction) {
			case 0:
				result = null;	// undefined / none?
				break;
			case 1:
				result = "1_unknown";
				break;
			case 2:
				result = "b";	// bootloader?
				break;
			case 3:
				result = "3_unknown";
				break;
			case 4:
				result = "s";	// system?
				break;
			case 5:
				result = "u";	// user?
				break;

			default:
				result = "undefined";
				break;
		}
		return result;
	},

	/**
	 * convert the 'dependency' keys from the binary prefix info into the common JSON
	 * format used by the describe messages.
	 *
	 * @private
	 */
	_binary_deps_to_describe: function(binaryInfo) {
		var result = {};
		var keys = Object.keys(binaryInfo);

		// iterate over the prefix info, looking for the keys we need.
		for(var i = 0; i < keys.length; i++) {
			var key = keys[i];
			var value = binaryInfo[key];

			switch (key) {
				case "depModuleFunction":
					result.f = this._mod_func_to_char(value);
					break;

				case "depModuleIndex":
					result.n = value + "";
					break;

				case "depModuleVersion":
					result.v = value;
					break;
			}
		}

		return result;
	},




	//	describe: {
	//    f: [
	//      "digitalread",
	//      "digitalwrite",
	//      "analogread",
	//      "analogwrite"
	//    ],
	//    v: {},
	//    p: 6,
	//    m: [
	//      {
	//        s: 16384,
	//        l: "m",
	//        vc: 30,
	//        vv: 28,
	//        f: "b",
	//        n: "0",
	//        v: 2,
	//        d: []
	//      },
	//      {
	//        s: 262144,
	//        l: "m",
	//        vc: 30,
	//        vv: 0,
	//        d: []
	//      },
	//      {
	//        s: 262144,
	//        l: "m",
	//        vc: 30,
	//        vv: 30,
	//        f: "s",
	//        n: "2",
	//        v: 1,
	//        d: [
	//          {
	//            f: "s",
	//            n: "1",
	//            v: 1,
	//            _: ""
	//          }
	//        ]
	//      },
	//      {
	//        s: 131072,
	//        l: "m",
	//        vc: 30,
	//        vv: 30,
	//        u: "2BA4E71E840F596B812003882AAE7CA6496F1590CA4A049310AF76EAF11C943A",
	//        f: "u",
	//        n: "1",
	//        v: 2,
	//        d: [
	//          {
	//            f: "s",
	//            n: "2",
	//            v: 1,
	//            _: ""
	//          }
	//        ]
	//      },
	//      {
	//        s: 131072,
	//        l: "f",
	//        vc: 30,
	//        vv: 30,
	//        u: "2BA4E71E840F596B812003882AAE7CA6496F1590CA4A049310AF76EAF11C943A",
	//        f: "u",
	//        n: "1",
	//        v: 2,
	//        d: [
	//          {
	//            f: "s",
	//            n: "2",
	//            v: 1,
	//            _: ""
	//          }
	//        ]
	//      }
	//    ]
	//  },


	_: null
};
module.exports = HalDependencyResolver;