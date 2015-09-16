/*
 *  Copyright 2015 Particle ( https://particle.io )
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

var BufferStream = function (buffer) { this.buf = buffer; };
BufferStream.prototype = {
    idx: 0,
    buf: null,
    seek: function(idx) {
        this.idx = idx;
    },
    read: function (size) {
        if (!this.buf) { return null; }

        var idx = this.idx,
            endIdx = idx + size;

        if (endIdx >= this.buf.length) {
            endIdx = this.buf.length;
        }

        var result = null;
        if ((endIdx - idx) > 0) {
            result = this.buf.slice(idx, endIdx);
            this.idx = endIdx;
        }
        return result;
    },
    end: function() {
        this.buf = null;
    }

};
module.exports = BufferStream;
