/**
 * Created by middleca on 6/11/15.
 */

module.exports = {
	/**
	 * TODO: replace with "buffer.compare" once we move to node 0.12
	 * @param left
	 * @param right
	 */
	bufferCompare: function(left, right) {
		if ((left == null) && (right == null)) {
			return true;
		}
		else if ((left == null) || (right == null)) {
			return false;
		}

		if (!Buffer.isBuffer(left)) {
			left = new Buffer(left);
		}
		if (!Buffer.isBuffer(right)) {
			right = new Buffer(right);
		}

		var same = (left.length == right.length),
			i = 0,
			max = left.length;

		while (i < max) {
			same &= (left[i] == right[i]);
			i++;
		}

		return same;
	},

	_: null
};