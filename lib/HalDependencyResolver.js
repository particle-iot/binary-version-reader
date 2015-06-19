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

		for(var i=0;i<arr.length;i++) {
			var item = arr[i];

			if (item.l != "m") {
				//not stored in main
				continue;
			}
			else if (item.f == "u") {
				//I'm a user module, bail
				break;
			}

			if ((i == 0) && (!item.n)) {
				item.n = i + "";
			}

			//skip the first one.
			if (i == 0) {
				continue;
			}

			// i is at least 1
			var lastItem = arr[i-1];
			var nextOne = ((i+1) < arr.length) ? arr[i+1] : null;

			if (lastItem.n && !item.n) {
				//last one had a name, and I don't have a name.
				item.n = (parseInt(lastItem.n) + 1) + "";

				if (!item.f) {
					item.f = "s";
				}
				if (!item.v) {
					item.v = 0;
				}
			}
		}
		return describe_info;

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