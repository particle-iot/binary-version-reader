https://github.com/spark/firmware/wiki/Retrieving-the-product-deets-from-a-user-application




Validating the Image
    
    The firmware image should be validated before use. This is done as follows:
    
    compute the CRC-32 checksum of the image, excluding the last 4 bytes (so bytes 0 through N-4, where N is the length of the file.)
    compare this computed checksum with the value stored in the last 4 bytes of the firmware image
    if the image valid, the checksum values will be identical.

