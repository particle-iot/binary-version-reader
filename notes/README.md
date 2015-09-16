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
 

# internal link
# TODO: public documentation for this
https://github.com/spark/firmware/wiki/Retrieving-the-product-deets-from-a-user-application


misc scratch notes:


Validating the Image
    
    The firmware image should be validated before use. This is done as follows:
        compute the CRC-32 checksum of the image, excluding the last 4 bytes (so bytes 0 through N-4, where N is the length of the file.)
        compare this computed checksum with the value stored in the last 4 bytes of the firmware image
        if the image valid, the checksum values will be identical.
    
