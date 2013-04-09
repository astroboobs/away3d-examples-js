// src/loaders/parsers/AWD2Parser.js
away3d.module("away3d.AWD2Parser", [
	'away3d.Parser'
],
function()
{
    var AWD2Parser = function()
    {
        away3d.Parser.call(this);
        this.$.curBlockId = 0;
        this.$.parsedHeader = false;
    };


    AWD2Parser.prototype = new away3d.Parser();
    AWD2Parser.prototype.constructor = AWD2Parser;


    AWD2Parser.prototype.proceedParsing = function(data)
    {
        if (!this.$.parsedHeader) {
            this.$.parsedHeader = true;
            parseHeader(this);
        }

        while (this.hasData() && this.shouldContinue()) {
            parseNextBlock(this);
        }
    };


    var parseHeader = function(self)
    {
        // Skip "AWD" magic string
        self.$.offset += 3;

        // Header
        var majorVersion = self.readUint8(),
            minorVersion = self.readUint8(),
            flags = self.readUint16(),
            compression = self.readUint8(),
            length = self.readUint32();

        // TODO: Fail if compressed (can't decompress in JS)
    };

    var parseNextBlock = function(self)
    {
        var ns, type, flags, len;

        self.$.curBlockId = self.readUint32();
        ns = self.readUint8();
        type = self.readUint8();
        flags = self.readUint8();
        len = self.readUint32();

        if (ns == 0) {
            // TODO: Implement all block types
            switch (type) {
                case 1:
                    parseGeometry(self);
                    break;
                case 23:
                    parseMesh(self);
                    break;
                case 81:
                    parseMaterial(self);
                    break;
                case 82:
                    parseTexture(self);
                    break;
                default:
                    // Unknown block type
                    self.seek(len);
                    break;
            };
        }
        else {
            // TODO: Deal with user blocks
            self.seek(len);
        }
    };

    var parseVarStr = function(self)
    {
        // TODO: Read string
        self.seek(self.readUint16());
        return '';
    };

    var parseMatrix3D = function(self)
    {
        var i = 0, data = [];

        while (i<16) {
            data[i++] = self.readFloat32(),
            data[i++] = self.readFloat32(),
            data[i++] = self.readFloat32(),
            data[i++] = 0;
        }

        data[15] = 1.0;

        return data;
    };

    var parseAttrValue = function(self, type, len)
    {
        var elemLen, readFunc;

        switch (type) {
            case 'uint32':
                elemLen = 4;
                readFunc = self.readUint32;
                break;
        }

        if (elemLen < len) {
            var list, numRead, numElems;
            
            list = [];
            numRead = 0;
            numElems = len / elemLen;
            while (numRead < numElems) {
                list.push(readFunc.call(self));
                numRead++;
            }
            
            return list;
        }
        else {
            return readFunc.call(self);
        }
    };

    var parseProperties = function(self, expected)
    {
        var listLen = self.readUint32(),
            listEnd = self.$.offset + listLen,
            props = {};

        while (self.$.offset < listEnd) {
            var key, len, type;
            
            key = self.readUint16();
            len = self.readUint32();
            if (expected && expected.hasOwnProperty(key)) {
                type = expected[key];
                props[key] = parseAttrValue(self, type, len);
            }
            else {
                self.seek(len);
            }
        }

        return props;
    };

    var parseGeometry = function(self)
    {
        var name, numSubs, subsParsed, data;

        // TODO: Do this per sub when subs are supported
        data = {
            vertexData: [],
            indexData: [],
            normalData: [],
            uvData: []
        };

        name = parseVarStr(self);
        numSubs = self.readUint16();

        // Geometry has no properties
        parseProperties(self);

        subsParsed = 0;
        while (subsParsed < numSubs) {
            var subLen, subEnd;

            subLen = self.readUint32();

            // SubGeometry has no properties
            parseProperties(self);

            subEnd = self.$.offset + subLen;

            while (self.$.offset < subEnd) {
                var strType, strFormat, strLen, strEnd;

                strType = self.readUint8();
                strFormat = self.readUint8();
                strLen = self.readUint32();
                strEnd = self.$.offset + strLen;

                // TODO: Respect strFormat

                if (strType == 1) {
                    while (self.$.offset < strEnd) {
                        data.vertexData.push(self.readFloat32());
                    }
                }
                else if (strType == 2) {
                    while (self.$.offset < strEnd) {
                        var i0 = self.readUint16();
                        data.indexData.push(self.readUint16());
                        data.indexData.push(i0);
                        data.indexData.push(self.readUint16());
                    }
                }
                else if (strType == 3) {
                    while (self.$.offset < strEnd) {
                        data.uvData.push(self.readFloat32());
                    }
                }
                else if (strType == 4) {
                    while (self.$.offset < strEnd) {
                        data.normalData.push(self.readFloat32());
                    }
                }
                else {
                    // TODO: Support all streams type
                    // Unsupported stream type
                    self.seek(strLen);
                }
            }

            // TODO: Deal with user attributes
            self.seek(4);

            subsParsed++;
        }

        // TODO: Deal with user attributes
        self.seek(4);

        self.finalizeAsset('geom', data, self.$.curBlockId);
    };
    
    
    var parseMesh = function(self)
    {
        var parentId, numMaterials, data = {};

        data.parent = self.readUint32();
        data.transform = parseMatrix3D(self);
        data.name = parseVarStr(self);
        data.geometry = self.readUint32();

        // TODO: Implement support for multiple materials
        numMaterials = self.readUint16();
        while (numMaterials--) {
            var mtl = self.readUint32();
            if (!data.material)
                data.material = mtl;
        }

        // TODO: Deal with properties and user attributes
        self.seek(8);

        self.finalizeAsset('mesh', data, self.$.curBlockId);
    };


    var parseTexture = function(self)
    {
        var name, type, len;

        name = parseVarStr(self);
        type = self.readUint8();
        len = self.readUint32();

        // TODO: Use dependency system
        //self.pauseAndRetrieveDependencies();

        if (type == 0) {
            // TODO: Support external textures
        }
        else {
            var str, end, binBuf, binBufLen, encoded, readSixtuple, LOOKUP;

            // TODO: Move all of this to ImageParser
            encoded = [];
            binBuf = 0;
            binBufLen = 0;

            LOOKUP = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
                    'a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z',
                    '0','1','2','3','4','5','6','7','8','9','+','/'];

            readSixtuple = function(allowFillBuf)
            {
                var sixtuple, excess, mask = 0x3f; // mask=111111b

                if (binBufLen < 6) {
                    if (allowFillBuf) {
                        var b = self.readUint8();
                        binBuf = (binBuf << 8) | b;
                        binBufLen += 8;
                    }
                    else {
                        // Can't fill buffer more, so just produce one last
                        // sixtet, padded with trailing zeroes.
                        binBuf = (binBuf << (6-binBufLen));
                        binBufLen = 6;
                    }
                }

                excess = binBufLen - 6;
                sixtuple = (binBuf >> excess);
                binBuf &= Math.pow(2, excess)-1;
                binBufLen -= 6;

                return sixtuple;
            };

            end = self.$.offset + len;
            while (self.$.offset < end || binBufLen > 0) {
                var b;

                b = readSixtuple(self.$.offset < end);
                encoded.push(LOOKUP[b]);
            }

            if (len%3==1) {
                encoded.push('=', '=');
            }
            else if (len%3==2) {
                encoded.push('=');
            }

            str = 'data:image/png;base64,'+encoded.join('');

            // TODO: Use dependency system
            self.finalizeAsset('texture', str, self.$.curBlockId);
            //self.resumeAfterDependencies();
        }

        // TODO: Deal with properties and user attributes
        self.seek(8);
    };


    parseMaterial = function(self)
    {
        var name, type, props, data = {},
            numMethods, methodsParsed = 0;

        name = parseVarStr(self);
        type = self.readUint8();
        numMethods = self.readUint8();

        // Read material numerical properties
        // (1=color, 2=bitmap url, 10=alpha, 11=alpha_blending, 12=alpha_threshold, 13=repeat)
        props = parseProperties(self, {
            1: 'uint32', 2: 'uint32' });

        // TODO: Don't just skip user attributes
        self.seek(4);

        while (methodsParsed < numMethods) {
            var methodType = self.readUint8();
            parseProperties(self);
            // TODO: Don't just skip user attributes
            self.seek(4);
        }

        if (type == 1) {
            // Color material
            // TODO: Don't hard-code
            data.color = props[1];
        }
        else if (type == 2) {
            // Texture material
            // TODO: Don't hard-code
            data.texture = props[2];
        }

        self.finalizeAsset('material', data, self.$.curBlockId);
    };


    return AWD2Parser;

});