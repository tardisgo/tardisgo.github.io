"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else {
  console.log("warning: no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $reflect, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length), i;
  for (i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(method) {
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $sliceToArray = function(slice) {
  if (slice.$length === 0) {
    return [];
  }
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length), i;
  for (i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "", i;
  for (i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(null, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, i, j = 0;
  for (i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "", i;
  for (i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length), i;
  for (i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length), i;
  $internalCopy(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copy = function(dst, src, type) {
  var i;
  switch (type.kind) {
  case "Array":
    $internalCopy(dst, src, 0, 0, src.length, type.elem);
    return true;
  case "Struct":
    for (i = 0; i < type.fields.length; i++) {
      var field = type.fields[i];
      var name = field[0];
      if (!$copy(dst[name], src[name], field[3])) {
        dst[name] = src[name];
      }
    }
    return true;
  default:
    return false;
  }
};

var $internalCopy = function(dst, src, dstOffset, srcOffset, n, elem) {
  var i;
  if (n === 0) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case "Array":
  case "Struct":
    for (i = 0; i < n; i++) {
      $copy(dst[dstOffset + i], src[srcOffset + i], elem);
    }
    return;
  }

  for (i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  $copy(clone, src, type);
  return clone;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero, i;
      for (i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $internalCopy(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (a === b) {
    return true;
  }
  var i;
  switch (type.kind) {
  case "Float32":
    return $float32IsEqual(a, b);
  case "Complex64":
    return $float32IsEqual(a.$real, b.$real) && $float32IsEqual(a.$imag, b.$imag);
  case "Complex128":
    return a.$real === b.$real && a.$imag === b.$imag;
  case "Int64":
  case "Uint64":
    return a.$high === b.$high && a.$low === b.$low;
  case "Ptr":
    if (a.constructor.Struct) {
      return false;
    }
    return $pointerIsEqual(a, b);
  case "Array":
    if (a.length != b.length) {
      return false;
    }
    var i;
    for (i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case "Struct":
    for (i = 0; i < type.fields.length; i++) {
      var field = type.fields[i];
      var name = field[0];
      if (!$equal(a[name], b[name], field[3])) {
        return false;
      }
    }
    return true;
  default:
    return false;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === null || b === null || a === undefined || b === undefined || a.constructor !== b.constructor) {
    return a === b;
  }
  switch (a.constructor.kind) {
  case "Func":
  case "Map":
  case "Slice":
  case "Struct":
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  case undefined: /* js.Object */
    return a === b;
  default:
    return $equal(a.$val, b.$val, a.constructor);
  }
};

var $float32IsEqual = function(a, b) {
  if (a === b) {
    return true;
  }
  if (a === 0 || b === 0 || a === 1/0 || b === 1/0 || a === -1/0 || b === -1/0 || a !== a || b !== b) {
    return false;
  }
  var math = $packages["math"];
  return math !== undefined && math.Float32bits(a) === math.Float32bits(b);
};

var $pointerIsEqual = function(a, b) {
  if (a === b) {
    return true;
  }
  if (a.$get === $throwNilPointerError || b.$get === $throwNilPointerError) {
    return a.$get === $throwNilPointerError && b.$get === $throwNilPointerError;
  }
  var va = a.$get();
  var vb = b.$get();
  if (va !== vb) {
    return false;
  }
  var dummy = va + 1;
  a.$set(dummy);
  var equal = b.$get() === dummy;
  a.$set(va);
  return equal;
};

var $newType = function(size, kind, string, name, pkgPath, constructor) {
  var typ;
  switch(kind) {
  case "Bool":
  case "Int":
  case "Int8":
  case "Int16":
  case "Int32":
  case "Uint":
  case "Uint8" :
  case "Uint16":
  case "Uint32":
  case "Uintptr":
  case "String":
  case "UnsafePointer":
    typ = function(v) { this.$val = v; };
    typ.prototype.$key = function() { return string + "$" + this.$val; };
    break;

  case "Float32":
  case "Float64":
    typ = function(v) { this.$val = v; };
    typ.prototype.$key = function() { return string + "$" + $floatKey(this.$val); };
    break;

  case "Int64":
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$high + "$" + this.$low; };
    break;

  case "Uint64":
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$high + "$" + this.$low; };
    break;

  case "Complex64":
  case "Complex128":
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$real + "$" + this.$imag; };
    break;

  case "Array":
    typ = function(v) { this.$val = v; };
    typ.Ptr = $newType(4, "Ptr", "*" + string, "", "", function(array) {
      this.$get = function() { return array; };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.prototype.$key = function() {
        return string + "$" + Array.prototype.join.call($mapArray(this.$val, function(e) {
          var key = e.$key ? e.$key() : String(e);
          return key.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.extendReflectType = function(rt) {
        rt.arrayType = new $reflect.arrayType.Ptr(rt, elem.reflectType(), undefined, len);
      };
      typ.Ptr.init(typ);
      Object.defineProperty(typ.Ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case "Chan":
    typ = function(capacity) {
      this.$val = this;
      this.$capacity = capacity;
      this.$buffer = [];
      this.$sendQueue = [];
      this.$recvQueue = [];
      this.$closed = false;
    };
    typ.prototype.$key = function() {
      if (this.$id === undefined) {
        $idCounter++;
        this.$id = $idCounter;
      }
      return String(this.$id);
    };
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
      typ.nil = new typ(0);
      typ.nil.$sendQueue = typ.nil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };
      typ.extendReflectType = function(rt) {
        rt.chanType = new $reflect.chanType.Ptr(rt, elem.reflectType(), sendOnly ? $reflect.SendDir : (recvOnly ? $reflect.RecvDir : $reflect.BothDir));
      };
    };
    break;

  case "Func":
    typ = function(v) { this.$val = v; };
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.extendReflectType = function(rt) {
        var typeSlice = ($sliceType($ptrType($reflect.rtype.Ptr)));
        rt.funcType = new $reflect.funcType.Ptr(rt, variadic, new typeSlice($mapArray(params, function(p) { return p.reflectType(); })), new typeSlice($mapArray(results, function(p) { return p.reflectType(); })));
      };
    };
    break;

  case "Interface":
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.init = function(methods) {
      typ.methods = methods;
      typ.extendReflectType = function(rt) {
        var imethods = $mapArray(methods, function(m) {
          return new $reflect.imethod.Ptr($newStringPtr(m[1]), $newStringPtr(m[2]), m[3].reflectType());
        });
        var methodSlice = ($sliceType($ptrType($reflect.imethod.Ptr)));
        rt.interfaceType = new $reflect.interfaceType.Ptr(rt, new methodSlice(imethods));
      };
    };
    break;

  case "Map":
    typ = function(v) { this.$val = v; };
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.extendReflectType = function(rt) {
        rt.mapType = new $reflect.mapType.Ptr(rt, key.reflectType(), elem.reflectType(), undefined, undefined);
      };
    };
    break;

  case "Ptr":
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.prototype.$key = function() {
      if (this.$id === undefined) {
        $idCounter++;
        this.$id = $idCounter;
      }
      return String(this.$id);
    };
    typ.init = function(elem) {
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
      typ.extendReflectType = function(rt) {
        rt.ptrType = new $reflect.ptrType.Ptr(rt, elem.reflectType());
      };
    };
    break;

  case "Slice":
    var nativeArray;
    typ = function(array) {
      if (array.constructor !== nativeArray) {
        array = new nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.make = function(length, capacity) {
      capacity = capacity || length;
      var array = new nativeArray(capacity), i;
      if (nativeArray === Array) {
        for (i = 0; i < capacity; i++) {
          array[i] = typ.elem.zero();
        }
      }
      var slice = new typ(array);
      slice.$length = length;
      return slice;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
      typ.extendReflectType = function(rt) {
        rt.sliceType = new $reflect.sliceType.Ptr(rt, elem.reflectType());
      };
    };
    break;

  case "Struct":
    typ = function(v) { this.$val = v; };
    typ.Ptr = $newType(4, "Ptr", "*" + string, "", "", constructor);
    typ.Ptr.Struct = typ;
    typ.Ptr.prototype.$get = function() { return this; };
    typ.init = function(fields) {
      var i;
      typ.fields = fields;
      typ.prototype.$key = function() {
        var val = this.$val;
        return string + "$" + $mapArray(fields, function(field) {
          var e = val[field[0]];
          var key = e.$key ? e.$key() : String(e);
          return key.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.Ptr.extendReflectType = function(rt) {
        rt.ptrType = new $reflect.ptrType.Ptr(rt, typ.reflectType());
      };
      /* nil value */
      typ.Ptr.nil = Object.create(constructor.prototype);
      typ.Ptr.nil.$val = typ.Ptr.nil;
      for (i = 0; i < fields.length; i++) {
        var field = fields[i];
        Object.defineProperty(typ.Ptr.nil, field[0], { get: $throwNilPointerError, set: $throwNilPointerError });
      }
      /* methods for embedded fields */
      for (i = 0; i < typ.methods.length; i++) {
        var m = typ.methods[i];
        if (m[4] != -1) {
          (function(field, methodName) {
            typ.prototype[methodName] = function() {
              var v = this.$val[field[0]];
              return v[methodName].apply(v, arguments);
            };
          })(fields[m[4]], m[0]);
        }
      }
      for (i = 0; i < typ.Ptr.methods.length; i++) {
        var m = typ.Ptr.methods[i];
        if (m[4] != -1) {
          (function(field, methodName) {
            typ.Ptr.prototype[methodName] = function() {
              var v = this[field[0]];
              if (v.$val === undefined) {
                v = new field[3](v);
              }
              return v[methodName].apply(v, arguments);
            };
          })(fields[m[4]], m[0]);
        }
      }
      /* reflect type */
      typ.extendReflectType = function(rt) {
        var reflectFields = new Array(fields.length), i;
        for (i = 0; i < fields.length; i++) {
          var field = fields[i];
          reflectFields[i] = new $reflect.structField.Ptr($newStringPtr(field[1]), $newStringPtr(field[2]), field[3].reflectType(), $newStringPtr(field[4]), i);
        }
        rt.structType = new $reflect.structType.Ptr(rt, new ($sliceType($reflect.structField.Ptr))(reflectFields));
      };
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch(kind) {
  case "Bool":
  case "Map":
    typ.zero = function() { return false; };
    break;

  case "Int":
  case "Int8":
  case "Int16":
  case "Int32":
  case "Uint":
  case "Uint8" :
  case "Uint16":
  case "Uint32":
  case "Uintptr":
  case "UnsafePointer":
  case "Float32":
  case "Float64":
    typ.zero = function() { return 0; };
    break;

  case "String":
    typ.zero = function() { return ""; };
    break;

  case "Int64":
  case "Uint64":
  case "Complex64":
  case "Complex128":
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case "Chan":
  case "Ptr":
  case "Slice":
    typ.zero = function() { return typ.nil; };
    break;

  case "Func":
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case "Interface":
    typ.zero = function() { return $ifaceNil; };
    break;

  case "Array":
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len), i;
      for (i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case "Struct":
    typ.zero = function() { return new typ.Ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.kind = kind;
  typ.string = string;
  typ.typeName = name;
  typ.pkgPath = pkgPath;
  typ.methods = [];
  var rt = null;
  typ.reflectType = function() {
    if (rt === null) {
      rt = new $reflect.rtype.Ptr(size, 0, 0, 0, 0, $reflect.kinds[kind], undefined, undefined, $newStringPtr(string), undefined, undefined);
      rt.jsType = typ;

      var methods = [];
      if (typ.methods !== undefined) {
        var i;
        for (i = 0; i < typ.methods.length; i++) {
          var m = typ.methods[i];
          var t = m[3];
          methods.push(new $reflect.method.Ptr($newStringPtr(m[1]), $newStringPtr(m[2]), t.reflectType(), $funcType([typ].concat(t.params), t.results, t.variadic).reflectType(), undefined, undefined));
        }
      }
      if (name !== "" || methods.length !== 0) {
        var methodSlice = ($sliceType($ptrType($reflect.method.Ptr)));
        rt.uncommonType = new $reflect.uncommonType.Ptr($newStringPtr(name), $newStringPtr(pkgPath), new methodSlice(methods));
        rt.uncommonType.jsType = typ;
      }

      if (typ.extendReflectType !== undefined) {
        typ.extendReflectType(rt);
      }
    }
    return rt;
  };
  return typ;
};

var $Bool          = $newType( 1, "Bool",          "bool",           "bool",       "", null);
var $Int           = $newType( 4, "Int",           "int",            "int",        "", null);
var $Int8          = $newType( 1, "Int8",          "int8",           "int8",       "", null);
var $Int16         = $newType( 2, "Int16",         "int16",          "int16",      "", null);
var $Int32         = $newType( 4, "Int32",         "int32",          "int32",      "", null);
var $Int64         = $newType( 8, "Int64",         "int64",          "int64",      "", null);
var $Uint          = $newType( 4, "Uint",          "uint",           "uint",       "", null);
var $Uint8         = $newType( 1, "Uint8",         "uint8",          "uint8",      "", null);
var $Uint16        = $newType( 2, "Uint16",        "uint16",         "uint16",     "", null);
var $Uint32        = $newType( 4, "Uint32",        "uint32",         "uint32",     "", null);
var $Uint64        = $newType( 8, "Uint64",        "uint64",         "uint64",     "", null);
var $Uintptr       = $newType( 4, "Uintptr",       "uintptr",        "uintptr",    "", null);
var $Float32       = $newType( 4, "Float32",       "float32",        "float32",    "", null);
var $Float64       = $newType( 8, "Float64",       "float64",        "float64",    "", null);
var $Complex64     = $newType( 8, "Complex64",     "complex64",      "complex64",  "", null);
var $Complex128    = $newType(16, "Complex128",    "complex128",     "complex128", "", null);
var $String        = $newType( 8, "String",        "string",         "string",     "", null);
var $UnsafePointer = $newType( 4, "UnsafePointer", "unsafe.Pointer", "Pointer",    "", null);

var $nativeArray = function(elemKind) {
  return ({ Int: Int32Array, Int8: Int8Array, Int16: Int16Array, Int32: Int32Array, Uint: Uint32Array, Uint8: Uint8Array, Uint16: Uint16Array, Uint32: Uint32Array, Uintptr: Uint32Array, Float32: Float32Array, Float64: Float64Array })[elemKind] || Array;
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var string = "[" + len + "]" + elem.string;
  var typ = $arrayTypes[string];
  if (typ === undefined) {
    typ = $newType(12, "Array", string, "", "", null);
    typ.init(elem, len);
    $arrayTypes[string] = typ;
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, "Chan", string, "", "", null);
    typ.init(elem, sendOnly, recvOnly);
    elem[field] = typ;
  }
  return typ;
};

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var paramTypes = $mapArray(params, function(p) { return p.string; });
  if (variadic) {
    paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
  }
  var string = "func(" + paramTypes.join(", ") + ")";
  if (results.length === 1) {
    string += " " + results[0].string;
  } else if (results.length > 1) {
    string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
  }
  var typ = $funcTypes[string];
  if (typ === undefined) {
    typ = $newType(4, "Func", string, "", "", null);
    typ.init(params, results, variadic);
    $funcTypes[string] = typ;
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var string = "interface {}";
  if (methods.length !== 0) {
    string = "interface { " + $mapArray(methods, function(m) {
      return (m[2] !== "" ? m[2] + "." : "") + m[1] + m[3].string.substr(4);
    }).join("; ") + " }";
  }
  var typ = $interfaceTypes[string];
  if (typ === undefined) {
    typ = $newType(8, "Interface", string, "", "", null);
    typ.init(methods);
    $interfaceTypes[string] = typ;
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = { $key: function() { return "nil"; } };
var $error = $newType(8, "Interface", "error", "error", "", null);
$error.init([["Error", "Error", "", $funcType([], [$String], false)]]);

var $Map = function() {};
(function() {
  var names = Object.getOwnPropertyNames(Object.prototype), i;
  for (i = 0; i < names.length; i++) {
    $Map.prototype[names[i]] = undefined;
  }
})();
var $mapTypes = {};
var $mapType = function(key, elem) {
  var string = "map[" + key.string + "]" + elem.string;
  var typ = $mapTypes[string];
  if (typ === undefined) {
    typ = $newType(4, "Map", string, "", "", null);
    typ.init(key, elem);
    $mapTypes[string] = typ;
  }
  return typ;
};


var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $ptrType = function(elem) {
  var typ = elem.Ptr;
  if (typ === undefined) {
    typ = $newType(4, "Ptr", "*" + elem.string, "", "", null);
    typ.init(elem);
    elem.Ptr = typ;
  }
  return typ;
};

var $stringPtrMap = new $Map();
var $newStringPtr = function(str) {
  if (str === undefined || str === "") {
    return $ptrType($String).nil;
  }
  var ptr = $stringPtrMap[str];
  if (ptr === undefined) {
    ptr = new ($ptrType($String))(function() { return str; }, function(v) { str = v; });
    $stringPtrMap[str] = ptr;
  }
  return ptr;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.Struct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $sliceType = function(elem) {
  var typ = elem.Slice;
  if (typ === undefined) {
    typ = $newType(12, "Slice", "[]" + elem.string, "", "", null);
    typ.init(elem);
    elem.Slice = typ;
  }
  return typ;
};

var $structTypes = {};
var $structType = function(fields) {
  var string = "struct { " + $mapArray(fields, function(f) {
    return f[1] + " " + f[3].string + (f[4] !== "" ? (" \"" + f[4].replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
  }).join("; ") + " }";
  if (fields.length === 0) {
    string = "struct {}";
  }
  var typ = $structTypes[string];
  if (typ === undefined) {
    typ = $newType(0, "Struct", string, "", "", function() {
      this.$val = this;
      var i;
      for (i = 0; i < fields.length; i++) {
        var field = fields[i];
        var arg = arguments[i];
        this[field[0]] = arg !== undefined ? arg : field[3].zero();
      }
    });
    /* collect methods for anonymous fields */
    var i, j;
    for (i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field[1] === "") {
        var methods = field[3].methods;
        for (j = 0; j < methods.length; j++) {
          var m = methods[j].slice(0, 6).concat([i]);
          typ.methods.push(m);
          typ.Ptr.methods.push(m);
        }
        if (field[3].kind === "Struct") {
          var methods = field[3].Ptr.methods;
          for (j = 0; j < methods.length; j++) {
            typ.Ptr.methods.push(methods[j].slice(0, 6).concat([i]));
          }
        }
      }
    }
    typ.init(fields);
    $structTypes[string] = typ;
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === "Interface"), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else if (type.string === "js.Object") {
    ok = true;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethods = value.constructor.methods;
      var typeMethods = type.methods;
      for (var i = 0; i < typeMethods.length; i++) {
        var tm = typeMethods[i];
        var found = false;
        for (var j = 0; j < valueMethods.length; j++) {
          var vm = valueMethods[j];
          if (vm[1] === tm[1] && vm[2] === tm[2] && vm[3] === tm[3]) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm[1];
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.Ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  return returnTuple ? [value, true] : value;
};

var $coerceFloat32 = function(f) {
  var math = $packages["math"];
  if (math === undefined) {
    return f;
  }
  return math.Float32frombits(math.Float32bits(f));
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0, i;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0, i;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === 1/0 || n.$real === -1/0 || n.$imag === 1/0 || n.$imag === -1/0;
  var dinf = d.$real === 1/0 || d.$real === -1/0 || d.$imag === 1/0 || d.$imag === -1/0;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(0/0, 0/0);
  }
  if (ninf && !dinf) {
    return new n.constructor(1/0, 1/0);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(0/0, 0/0);
    }
    return new n.constructor(1/0, 1/0);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $deferFrames = [], $skippedDeferFrames = 0, $jumpToDefer = false, $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr) {
  if ($skippedDeferFrames !== 0) {
    $skippedDeferFrames--;
    throw jsErr;
  }
  if ($jumpToDefer) {
    $jumpToDefer = false;
    throw jsErr;
  }
  if (jsErr) {
    var newErr = null;
    try {
      $deferFrames.push(deferred);
      $panic(new $packages["github.com/gopherjs/gopherjs/js"].Error.Ptr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $deferFrames.pop();
    $callDeferred(deferred, newErr);
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  var call;
  try {
    while (true) {
      if (deferred === null) {
        deferred = $deferFrames[$deferFrames.length - 1 - $skippedDeferFrames];
        if (deferred === undefined) {
          if (localPanicValue.constructor === $String) {
            throw new Error(localPanicValue.$val);
          } else if (localPanicValue.Error !== undefined) {
            throw new Error(localPanicValue.Error());
          } else if (localPanicValue.String !== undefined) {
            throw new Error(localPanicValue.String());
          } else {
            throw new Error(localPanicValue);
          }
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        if (localPanicValue !== undefined) {
          $skippedDeferFrames++;
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(undefined, call[1]);
      if (r && r.$blocking) {
        deferred.push([r, []]);
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if ($curGoroutine.asleep) {
      deferred.push(call);
      $jumpToDefer = true;
    }
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $nonblockingCall = function() {
  $panic(new $packages["runtime"].NotSupportedError.Ptr("non-blocking call to blocking function (mark call with \"//gopherjs:blocking\" to fix)"));
};
var $throw = function(err) { throw err; };
var $throwRuntimeError; /* set by package "runtime" */

var $dummyGoroutine = { asleep: false, exit: false, panicStack: [] };
var $curGoroutine = $dummyGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  args.push(true);
  var goroutine = function() {
    var rescheduled = false;
    try {
      $curGoroutine = goroutine;
      $skippedDeferFrames = 0;
      $jumpToDefer = false;
      var r = fun.apply(undefined, args);
      if (r && r.$blocking) {
        fun = r;
        args = [];
        $schedule(goroutine, direct);
        rescheduled = true;
        return;
      }
      goroutine.exit = true;
    } catch (err) {
      if (!$curGoroutine.asleep) {
        goroutine.exit = true;
        throw err;
      }
    } finally {
      $curGoroutine = $dummyGoroutine;
      if (goroutine.exit && !rescheduled) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        goroutine.asleep = true;
      }
      if (goroutine.asleep && !rescheduled) {
        $awakeGoroutines--;
        if ($awakeGoroutines === 0 && $totalGoroutines !== 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
        }
      }
    }
  };
  goroutine.asleep = false;
  goroutine.exit = false;
  goroutine.panicStack = [];
  $schedule(goroutine, direct);
};

var $scheduled = [], $schedulerLoopActive = false;
var $schedule = function(goroutine, direct) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }

  if (direct) {
    goroutine();
    return;
  }

  $scheduled.push(goroutine);
  if (!$schedulerLoopActive) {
    $schedulerLoopActive = true;
    setTimeout(function() {
      while (true) {
        var r = $scheduled.shift();
        if (r === undefined) {
          $schedulerLoopActive = false;
          break;
        }
        r();
      };
    }, 0);
  }
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  chan.$sendQueue.push(function() {
    $schedule(thisGoroutine);
    return value;
  });
  var blocked = false;
  var f = function() {
    if (blocked) {
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      return;
    };
    blocked = true;
    $curGoroutine.asleep = true;
    throw null;
  };
  f.$blocking = true;
  return f;
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend());
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.constructor.elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine, value;
  var queueEntry = function(v) {
    value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  var blocked = false;
  var f = function() {
    if (blocked) {
      return value;
    };
    blocked = true;
    $curGoroutine.asleep = true;
    throw null;
  };
  f.$blocking = true;
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(); /* will panic because of closed channel */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.constructor.elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [], i;
  var selection = -1;
  for (i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var removeFromQueues = function() {
    for (i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  var blocked = false;
  var f = function() {
    if (blocked) {
      return selection;
    };
    blocked = true;
    $curGoroutine.asleep = true;
    throw null;
  };
  f.$blocking = true;
  return f;
};

var $needsExternalization = function(t) {
  switch (t.kind) {
    case "Bool":
    case "Int":
    case "Int8":
    case "Int16":
    case "Int32":
    case "Uint":
    case "Uint8":
    case "Uint16":
    case "Uint32":
    case "Uintptr":
    case "Float32":
    case "Float64":
      return false;
    case "Interface":
      return t !== $packages["github.com/gopherjs/gopherjs/js"].Object;
    default:
      return true;
  }
};

var $externalize = function(v, t) {
  switch (t.kind) {
  case "Bool":
  case "Int":
  case "Int8":
  case "Int16":
  case "Int32":
  case "Uint":
  case "Uint8":
  case "Uint16":
  case "Uint32":
  case "Uintptr":
  case "Float32":
  case "Float64":
    return v;
  case "Int64":
  case "Uint64":
    return $flatten64(v);
  case "Array":
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case "Func":
    if (v === $throwNilPointerError) {
      return null;
    }
    if (v.$externalizeWrapper === undefined) {
      $checkForDeadlock = false;
      var convert = false;
      var i;
      for (i = 0; i < t.params.length; i++) {
        convert = convert || (t.params[i] !== $packages["github.com/gopherjs/gopherjs/js"].Object);
      }
      for (i = 0; i < t.results.length; i++) {
        convert = convert || $needsExternalization(t.results[i]);
      }
      if (!convert) {
        return v;
      }
      v.$externalizeWrapper = function() {
        var args = [], i;
        for (i = 0; i < t.params.length; i++) {
          if (t.variadic && i === t.params.length - 1) {
            var vt = t.params[i].elem, varargs = [], j;
            for (j = i; j < arguments.length; j++) {
              varargs.push($internalize(arguments[j], vt));
            }
            args.push(new (t.params[i])(varargs));
            break;
          }
          args.push($internalize(arguments[i], t.params[i]));
        }
        var result = v.apply(this, args);
        switch (t.results.length) {
        case 0:
          return;
        case 1:
          return $externalize(result, t.results[0]);
        default:
          for (i = 0; i < t.results.length; i++) {
            result[i] = $externalize(result[i], t.results[i]);
          }
          return result;
        }
      };
    }
    return v.$externalizeWrapper;
  case "Interface":
    if (v === $ifaceNil) {
      return null;
    }
    if (t === $packages["github.com/gopherjs/gopherjs/js"].Object || v.constructor.kind === undefined) {
      return v;
    }
    return $externalize(v.$val, v.constructor);
  case "Map":
    var m = {};
    var keys = $keys(v), i;
    for (i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case "Ptr":
    var o = {}, i;
    for (i = 0; i < t.methods.length; i++) {
      var m = t.methods[i];
      if (m[2] !== "") { /* not exported */
        continue;
      }
      (function(m) {
        o[m[1]] = $externalize(function() {
          return v[m[0]].apply(v, arguments);
        }, m[3]);
      })(m);
    }
    return o;
  case "Slice":
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case "String":
    var s = "", r, i, j = 0;
    for (i = 0; i < v.length; i += r[1], j++) {
      r = $decodeRune(v, i);
      s += String.fromCharCode(r[0]);
    }
    return s;
  case "Struct":
    var timePkg = $packages["time"];
    if (timePkg && v.constructor === timePkg.Time.Ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }
    var o = {}, i;
    for (i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (f[2] !== "") { /* not exported */
        continue;
      }
      o[f[1]] = $externalize(v[f[0]], f[3]);
    }
    return o;
  }
  $panic(new $String("cannot externalize " + t.string));
};

var $internalize = function(v, t, recv) {
  switch (t.kind) {
  case "Bool":
    return !!v;
  case "Int":
    return parseInt(v);
  case "Int8":
    return parseInt(v) << 24 >> 24;
  case "Int16":
    return parseInt(v) << 16 >> 16;
  case "Int32":
    return parseInt(v) >> 0;
  case "Uint":
    return parseInt(v);
  case "Uint8":
    return parseInt(v) << 24 >>> 24;
  case "Uint16":
    return parseInt(v) << 16 >>> 16;
  case "Uint32":
  case "Uintptr":
    return parseInt(v) >>> 0;
  case "Int64":
  case "Uint64":
    return new t(0, v);
  case "Float32":
  case "Float64":
    return parseFloat(v);
  case "Array":
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case "Func":
    return function() {
      var args = [], i;
      for (i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i], j;
          for (j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case "Interface":
    if (t === $packages["github.com/gopherjs/gopherjs/js"].Object) {
      return v;
    }
    if (v === null) {
      return $ifaceNil;
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      var timePkg = $packages["time"];
      if (timePkg) {
        return new timePkg.Time(timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000)));
      }
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$packages["github.com/gopherjs/gopherjs/js"].Object], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return v;
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case "Map":
    var m = new $Map();
    var keys = $keys(v), i;
    for (i = 0; i < keys.length; i++) {
      var key = $internalize(keys[i], t.key);
      m[key.$key ? key.$key() : key] = { k: key, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case "Slice":
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case "String":
    v = String(v);
    var s = "", i;
    for (i = 0; i < v.length; i++) {
      s += $encodeRune(v.charCodeAt(i));
    }
    return s;
  default:
    $panic(new $String("cannot internalize " + t.string));
  }
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, Object, Error, init;
	Object = $pkg.Object = $newType(8, "Interface", "js.Object", "Object", "github.com/gopherjs/gopherjs/js", null);
	Error = $pkg.Error = $newType(0, "Struct", "js.Error", "Error", "github.com/gopherjs/gopherjs/js", function(Object_) {
		this.$val = this;
		this.Object = Object_ !== undefined ? Object_ : $ifaceNil;
	});
	Error.Ptr.prototype.Error = function() {
		var err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	init = function() {
		var e;
		e = new Error.Ptr($ifaceNil);
	};
	$pkg.$init = function() {
		Object.init([["Bool", "Bool", "", $funcType([], [$Bool], false)], ["Call", "Call", "", $funcType([$String, ($sliceType($emptyInterface))], [Object], true)], ["Delete", "Delete", "", $funcType([$String], [], false)], ["Float", "Float", "", $funcType([], [$Float64], false)], ["Get", "Get", "", $funcType([$String], [Object], false)], ["Index", "Index", "", $funcType([$Int], [Object], false)], ["Int", "Int", "", $funcType([], [$Int], false)], ["Int64", "Int64", "", $funcType([], [$Int64], false)], ["Interface", "Interface", "", $funcType([], [$emptyInterface], false)], ["Invoke", "Invoke", "", $funcType([($sliceType($emptyInterface))], [Object], true)], ["IsNull", "IsNull", "", $funcType([], [$Bool], false)], ["IsUndefined", "IsUndefined", "", $funcType([], [$Bool], false)], ["Length", "Length", "", $funcType([], [$Int], false)], ["New", "New", "", $funcType([($sliceType($emptyInterface))], [Object], true)], ["Set", "Set", "", $funcType([$String, $emptyInterface], [], false)], ["SetIndex", "SetIndex", "", $funcType([$Int, $emptyInterface], [], false)], ["Str", "Str", "", $funcType([], [$String], false)], ["Uint64", "Uint64", "", $funcType([], [$Uint64], false)], ["Unsafe", "Unsafe", "", $funcType([], [$Uintptr], false)]]);
		Error.methods = [["Bool", "Bool", "", $funcType([], [$Bool], false), 0], ["Call", "Call", "", $funcType([$String, ($sliceType($emptyInterface))], [Object], true), 0], ["Delete", "Delete", "", $funcType([$String], [], false), 0], ["Float", "Float", "", $funcType([], [$Float64], false), 0], ["Get", "Get", "", $funcType([$String], [Object], false), 0], ["Index", "Index", "", $funcType([$Int], [Object], false), 0], ["Int", "Int", "", $funcType([], [$Int], false), 0], ["Int64", "Int64", "", $funcType([], [$Int64], false), 0], ["Interface", "Interface", "", $funcType([], [$emptyInterface], false), 0], ["Invoke", "Invoke", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["IsNull", "IsNull", "", $funcType([], [$Bool], false), 0], ["IsUndefined", "IsUndefined", "", $funcType([], [$Bool], false), 0], ["Length", "Length", "", $funcType([], [$Int], false), 0], ["New", "New", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["Set", "Set", "", $funcType([$String, $emptyInterface], [], false), 0], ["SetIndex", "SetIndex", "", $funcType([$Int, $emptyInterface], [], false), 0], ["Str", "Str", "", $funcType([], [$String], false), 0], ["Uint64", "Uint64", "", $funcType([], [$Uint64], false), 0], ["Unsafe", "Unsafe", "", $funcType([], [$Uintptr], false), 0]];
		($ptrType(Error)).methods = [["Bool", "Bool", "", $funcType([], [$Bool], false), 0], ["Call", "Call", "", $funcType([$String, ($sliceType($emptyInterface))], [Object], true), 0], ["Delete", "Delete", "", $funcType([$String], [], false), 0], ["Error", "Error", "", $funcType([], [$String], false), -1], ["Float", "Float", "", $funcType([], [$Float64], false), 0], ["Get", "Get", "", $funcType([$String], [Object], false), 0], ["Index", "Index", "", $funcType([$Int], [Object], false), 0], ["Int", "Int", "", $funcType([], [$Int], false), 0], ["Int64", "Int64", "", $funcType([], [$Int64], false), 0], ["Interface", "Interface", "", $funcType([], [$emptyInterface], false), 0], ["Invoke", "Invoke", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["IsNull", "IsNull", "", $funcType([], [$Bool], false), 0], ["IsUndefined", "IsUndefined", "", $funcType([], [$Bool], false), 0], ["Length", "Length", "", $funcType([], [$Int], false), 0], ["New", "New", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["Set", "Set", "", $funcType([$String, $emptyInterface], [], false), 0], ["SetIndex", "SetIndex", "", $funcType([$Int, $emptyInterface], [], false), 0], ["Str", "Str", "", $funcType([], [$String], false), 0], ["Uint64", "Uint64", "", $funcType([], [$Uint64], false), 0], ["Unsafe", "Unsafe", "", $funcType([], [$Uintptr], false), 0]];
		Error.init([["Object", "", "", Object, ""]]);
		init();
	};
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, js = $packages["github.com/gopherjs/gopherjs/js"], NotSupportedError, TypeAssertionError, errorString, MemStats, sizeof_C_MStats, init, init$1;
	NotSupportedError = $pkg.NotSupportedError = $newType(0, "Struct", "runtime.NotSupportedError", "NotSupportedError", "runtime", function(Feature_) {
		this.$val = this;
		this.Feature = Feature_ !== undefined ? Feature_ : "";
	});
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, "Struct", "runtime.TypeAssertionError", "TypeAssertionError", "runtime", function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		this.interfaceString = interfaceString_ !== undefined ? interfaceString_ : "";
		this.concreteString = concreteString_ !== undefined ? concreteString_ : "";
		this.assertedString = assertedString_ !== undefined ? assertedString_ : "";
		this.missingMethod = missingMethod_ !== undefined ? missingMethod_ : "";
	});
	errorString = $pkg.errorString = $newType(8, "String", "runtime.errorString", "errorString", "runtime", null);
	MemStats = $pkg.MemStats = $newType(0, "Struct", "runtime.MemStats", "MemStats", "runtime", function(Alloc_, TotalAlloc_, Sys_, Lookups_, Mallocs_, Frees_, HeapAlloc_, HeapSys_, HeapIdle_, HeapInuse_, HeapReleased_, HeapObjects_, StackInuse_, StackSys_, MSpanInuse_, MSpanSys_, MCacheInuse_, MCacheSys_, BuckHashSys_, GCSys_, OtherSys_, NextGC_, LastGC_, PauseTotalNs_, PauseNs_, NumGC_, EnableGC_, DebugGC_, BySize_) {
		this.$val = this;
		this.Alloc = Alloc_ !== undefined ? Alloc_ : new $Uint64(0, 0);
		this.TotalAlloc = TotalAlloc_ !== undefined ? TotalAlloc_ : new $Uint64(0, 0);
		this.Sys = Sys_ !== undefined ? Sys_ : new $Uint64(0, 0);
		this.Lookups = Lookups_ !== undefined ? Lookups_ : new $Uint64(0, 0);
		this.Mallocs = Mallocs_ !== undefined ? Mallocs_ : new $Uint64(0, 0);
		this.Frees = Frees_ !== undefined ? Frees_ : new $Uint64(0, 0);
		this.HeapAlloc = HeapAlloc_ !== undefined ? HeapAlloc_ : new $Uint64(0, 0);
		this.HeapSys = HeapSys_ !== undefined ? HeapSys_ : new $Uint64(0, 0);
		this.HeapIdle = HeapIdle_ !== undefined ? HeapIdle_ : new $Uint64(0, 0);
		this.HeapInuse = HeapInuse_ !== undefined ? HeapInuse_ : new $Uint64(0, 0);
		this.HeapReleased = HeapReleased_ !== undefined ? HeapReleased_ : new $Uint64(0, 0);
		this.HeapObjects = HeapObjects_ !== undefined ? HeapObjects_ : new $Uint64(0, 0);
		this.StackInuse = StackInuse_ !== undefined ? StackInuse_ : new $Uint64(0, 0);
		this.StackSys = StackSys_ !== undefined ? StackSys_ : new $Uint64(0, 0);
		this.MSpanInuse = MSpanInuse_ !== undefined ? MSpanInuse_ : new $Uint64(0, 0);
		this.MSpanSys = MSpanSys_ !== undefined ? MSpanSys_ : new $Uint64(0, 0);
		this.MCacheInuse = MCacheInuse_ !== undefined ? MCacheInuse_ : new $Uint64(0, 0);
		this.MCacheSys = MCacheSys_ !== undefined ? MCacheSys_ : new $Uint64(0, 0);
		this.BuckHashSys = BuckHashSys_ !== undefined ? BuckHashSys_ : new $Uint64(0, 0);
		this.GCSys = GCSys_ !== undefined ? GCSys_ : new $Uint64(0, 0);
		this.OtherSys = OtherSys_ !== undefined ? OtherSys_ : new $Uint64(0, 0);
		this.NextGC = NextGC_ !== undefined ? NextGC_ : new $Uint64(0, 0);
		this.LastGC = LastGC_ !== undefined ? LastGC_ : new $Uint64(0, 0);
		this.PauseTotalNs = PauseTotalNs_ !== undefined ? PauseTotalNs_ : new $Uint64(0, 0);
		this.PauseNs = PauseNs_ !== undefined ? PauseNs_ : ($arrayType($Uint64, 256)).zero();
		this.NumGC = NumGC_ !== undefined ? NumGC_ : 0;
		this.EnableGC = EnableGC_ !== undefined ? EnableGC_ : false;
		this.DebugGC = DebugGC_ !== undefined ? DebugGC_ : false;
		this.BySize = BySize_ !== undefined ? BySize_ : ($arrayType(($structType([["Size", "Size", "", $Uint32, ""], ["Mallocs", "Mallocs", "", $Uint64, ""], ["Frees", "Frees", "", $Uint64, ""]])), 61)).zero();
	});
	NotSupportedError.Ptr.prototype.Error = function() {
		var err;
		err = this;
		return "not supported by GopherJS: " + err.Feature;
	};
	NotSupportedError.prototype.Error = function() { return this.$val.Error(); };
	init = function() {
		var e;
		$throwRuntimeError = (function(msg) {
			$panic(new errorString(msg));
		});
		e = $ifaceNil;
		e = new TypeAssertionError.Ptr("", "", "", "");
		e = new NotSupportedError.Ptr("");
	};
	TypeAssertionError.Ptr.prototype.RuntimeError = function() {
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.Ptr.prototype.Error = function() {
		var e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var e;
		e = this.$val !== undefined ? this.$val : this;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var e;
		e = this.$val !== undefined ? this.$val : this;
		return "runtime error: " + e;
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	init$1 = function() {
		var memStats;
		memStats = new MemStats.Ptr(); $copy(memStats, new MemStats.Ptr(), MemStats);
		if (!((sizeof_C_MStats === 3712))) {
			console.log(sizeof_C_MStats, 3712);
			$panic(new $String("MStats vs MemStatsType size mismatch"));
		}
	};
	$pkg.$init = function() {
		($ptrType(NotSupportedError)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1]];
		NotSupportedError.init([["Feature", "Feature", "", $String, ""]]);
		($ptrType(TypeAssertionError)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1], ["RuntimeError", "RuntimeError", "", $funcType([], [], false), -1]];
		TypeAssertionError.init([["interfaceString", "interfaceString", "runtime", $String, ""], ["concreteString", "concreteString", "runtime", $String, ""], ["assertedString", "assertedString", "runtime", $String, ""], ["missingMethod", "missingMethod", "runtime", $String, ""]]);
		errorString.methods = [["Error", "Error", "", $funcType([], [$String], false), -1], ["RuntimeError", "RuntimeError", "", $funcType([], [], false), -1]];
		($ptrType(errorString)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1], ["RuntimeError", "RuntimeError", "", $funcType([], [], false), -1]];
		MemStats.init([["Alloc", "Alloc", "", $Uint64, ""], ["TotalAlloc", "TotalAlloc", "", $Uint64, ""], ["Sys", "Sys", "", $Uint64, ""], ["Lookups", "Lookups", "", $Uint64, ""], ["Mallocs", "Mallocs", "", $Uint64, ""], ["Frees", "Frees", "", $Uint64, ""], ["HeapAlloc", "HeapAlloc", "", $Uint64, ""], ["HeapSys", "HeapSys", "", $Uint64, ""], ["HeapIdle", "HeapIdle", "", $Uint64, ""], ["HeapInuse", "HeapInuse", "", $Uint64, ""], ["HeapReleased", "HeapReleased", "", $Uint64, ""], ["HeapObjects", "HeapObjects", "", $Uint64, ""], ["StackInuse", "StackInuse", "", $Uint64, ""], ["StackSys", "StackSys", "", $Uint64, ""], ["MSpanInuse", "MSpanInuse", "", $Uint64, ""], ["MSpanSys", "MSpanSys", "", $Uint64, ""], ["MCacheInuse", "MCacheInuse", "", $Uint64, ""], ["MCacheSys", "MCacheSys", "", $Uint64, ""], ["BuckHashSys", "BuckHashSys", "", $Uint64, ""], ["GCSys", "GCSys", "", $Uint64, ""], ["OtherSys", "OtherSys", "", $Uint64, ""], ["NextGC", "NextGC", "", $Uint64, ""], ["LastGC", "LastGC", "", $Uint64, ""], ["PauseTotalNs", "PauseTotalNs", "", $Uint64, ""], ["PauseNs", "PauseNs", "", ($arrayType($Uint64, 256)), ""], ["NumGC", "NumGC", "", $Uint32, ""], ["EnableGC", "EnableGC", "", $Bool, ""], ["DebugGC", "DebugGC", "", $Bool, ""], ["BySize", "BySize", "", ($arrayType(($structType([["Size", "Size", "", $Uint32, ""], ["Mallocs", "Mallocs", "", $Uint64, ""], ["Frees", "Frees", "", $Uint64, ""]])), 61)), ""]]);
		sizeof_C_MStats = 3712;
		init();
		init$1();
	};
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, js = $packages["github.com/gopherjs/gopherjs/js"], math, zero, negInf, nan, pow10tab, init, Exp, Ldexp, Log, Float32bits, Float32frombits, init$1;
	init = function() {
		Float32bits(0);
		Float32frombits(0);
	};
	Exp = $pkg.Exp = function(x) {
		return $parseFloat(math.exp(x));
	};
	Ldexp = $pkg.Ldexp = function(frac, exp$1) {
		if (frac === 0) {
			return frac;
		}
		if (exp$1 >= 1024) {
			return frac * $parseFloat(math.pow(2, 1023)) * $parseFloat(math.pow(2, exp$1 - 1023 >> 0));
		}
		if (exp$1 <= -1024) {
			return frac * $parseFloat(math.pow(2, -1023)) * $parseFloat(math.pow(2, exp$1 + 1023 >> 0));
		}
		return frac * $parseFloat(math.pow(2, exp$1));
	};
	Log = $pkg.Log = function(x) {
		if (!((x === x))) {
			return nan;
		}
		return $parseFloat(math.log(x));
	};
	Float32bits = $pkg.Float32bits = function(f) {
		var s, e, r;
		if ($float32IsEqual(f, 0)) {
			if ($float32IsEqual(1 / f, negInf)) {
				return 2147483648;
			}
			return 0;
		}
		if (!(($float32IsEqual(f, f)))) {
			return 2143289344;
		}
		s = 0;
		if (f < 0) {
			s = 2147483648;
			f = -f;
		}
		e = 150;
		while (f >= 1.6777216e+07) {
			f = f / (2);
			if (e === 255) {
				break;
			}
			e = e + (1) >>> 0;
		}
		while (f < 8.388608e+06) {
			e = e - (1) >>> 0;
			if (e === 0) {
				break;
			}
			f = f * (2);
		}
		r = $parseFloat($mod(f, 2));
		if ((r > 0.5 && r < 1) || r >= 1.5) {
			f = f + (1);
		}
		return (((s | (e << 23 >>> 0)) >>> 0) | (((f >> 0) & ~8388608))) >>> 0;
	};
	Float32frombits = $pkg.Float32frombits = function(b) {
		var s, e, m;
		s = 1;
		if (!((((b & 2147483648) >>> 0) === 0))) {
			s = -1;
		}
		e = (((b >>> 23 >>> 0)) & 255) >>> 0;
		m = (b & 8388607) >>> 0;
		if (e === 255) {
			if (m === 0) {
				return s / 0;
			}
			return nan;
		}
		if (!((e === 0))) {
			m = m + (8388608) >>> 0;
		}
		if (e === 0) {
			e = 1;
		}
		return Ldexp(m, ((e >> 0) - 127 >> 0) - 23 >> 0) * s;
	};
	init$1 = function() {
		var i, _q, m, x;
		pow10tab[0] = 1;
		pow10tab[1] = 10;
		i = 2;
		while (i < 70) {
			m = (_q = i / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			(i < 0 || i >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[i] = ((m < 0 || m >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[m]) * (x = i - m >> 0, ((x < 0 || x >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[x]));
			i = i + (1) >> 0;
		}
	};
	$pkg.$init = function() {
		pow10tab = ($arrayType($Float64, 70)).zero();
		math = $global.Math;
		zero = 0;
		negInf = -1 / zero;
		nan = 0 / zero;
		init();
		init$1();
	};
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, CompareAndSwapInt32, AddInt32;
	CompareAndSwapInt32 = $pkg.CompareAndSwapInt32 = function(addr, old, new$1) {
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	AddInt32 = $pkg.AddInt32 = function(addr, delta) {
		var new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.$init = function() {
	};
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, atomic = $packages["sync/atomic"], runtime = $packages["runtime"], Pool, Mutex, poolLocal, syncSema, allPools, runtime_registerPoolCleanup, runtime_Syncsemcheck, poolCleanup, init, indexLocal, runtime_Semacquire, runtime_Semrelease, init$1;
	Pool = $pkg.Pool = $newType(0, "Struct", "sync.Pool", "Pool", "sync", function(local_, localSize_, store_, New_) {
		this.$val = this;
		this.local = local_ !== undefined ? local_ : 0;
		this.localSize = localSize_ !== undefined ? localSize_ : 0;
		this.store = store_ !== undefined ? store_ : ($sliceType($emptyInterface)).nil;
		this.New = New_ !== undefined ? New_ : $throwNilPointerError;
	});
	Mutex = $pkg.Mutex = $newType(0, "Struct", "sync.Mutex", "Mutex", "sync", function(state_, sema_) {
		this.$val = this;
		this.state = state_ !== undefined ? state_ : 0;
		this.sema = sema_ !== undefined ? sema_ : 0;
	});
	poolLocal = $pkg.poolLocal = $newType(0, "Struct", "sync.poolLocal", "poolLocal", "sync", function(private$0_, shared_, Mutex_, pad_) {
		this.$val = this;
		this.private$0 = private$0_ !== undefined ? private$0_ : $ifaceNil;
		this.shared = shared_ !== undefined ? shared_ : ($sliceType($emptyInterface)).nil;
		this.Mutex = Mutex_ !== undefined ? Mutex_ : new Mutex.Ptr();
		this.pad = pad_ !== undefined ? pad_ : ($arrayType($Uint8, 128)).zero();
	});
	syncSema = $pkg.syncSema = $newType(12, "Array", "sync.syncSema", "syncSema", "sync", null);
	Pool.Ptr.prototype.Get = function() {
		var p, x, x$1, x$2;
		p = this;
		if (p.store.$length === 0) {
			if (!(p.New === $throwNilPointerError)) {
				return p.New();
			}
			return $ifaceNil;
		}
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		return x$2;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.Ptr.prototype.Put = function(x) {
		var p;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
	};
	runtime_Syncsemcheck = function(size) {
	};
	Mutex.Ptr.prototype.Lock = function() {
		var m, awoke, old, new$1;
		m = this;
		if (atomic.CompareAndSwapInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), 0, 1)) {
			return;
		}
		awoke = false;
		while (true) {
			old = m.state;
			new$1 = old | 1;
			if (!(((old & 1) === 0))) {
				new$1 = old + 4 >> 0;
			}
			if (awoke) {
				new$1 = new$1 & ~(2);
			}
			if (atomic.CompareAndSwapInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), old, new$1)) {
				if ((old & 1) === 0) {
					break;
				}
				runtime_Semacquire(new ($ptrType($Uint32))(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m));
				awoke = true;
			}
		}
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.Ptr.prototype.Unlock = function() {
		var m, new$1, old;
		m = this;
		new$1 = atomic.AddInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		old = new$1;
		while (true) {
			if (((old >> 2 >> 0) === 0) || !(((old & 3) === 0))) {
				return;
			}
			new$1 = ((old - 4 >> 0)) | 2;
			if (atomic.CompareAndSwapInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), old, new$1)) {
				runtime_Semrelease(new ($ptrType($Uint32))(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m));
				return;
			}
			old = m.state;
		}
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	poolCleanup = function() {
		var _ref, _i, i, p, i$1, l, _ref$1, _i$1, j, x;
		_ref = allPools;
		_i = 0;
		while (_i < _ref.$length) {
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			(i < 0 || i >= allPools.$length) ? $throwRuntimeError("index out of range") : allPools.$array[allPools.$offset + i] = ($ptrType(Pool)).nil;
			i$1 = 0;
			while (i$1 < (p.localSize >> 0)) {
				l = indexLocal(p.local, i$1);
				l.private$0 = $ifaceNil;
				_ref$1 = l.shared;
				_i$1 = 0;
				while (_i$1 < _ref$1.$length) {
					j = _i$1;
					(x = l.shared, (j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j] = $ifaceNil);
					_i$1++;
				}
				l.shared = ($sliceType($emptyInterface)).nil;
				i$1 = i$1 + (1) >> 0;
			}
			_i++;
		}
		allPools = new ($sliceType(($ptrType(Pool))))([]);
	};
	init = function() {
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var x;
		return (x = l, (x.nilCheck, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i])));
	};
	runtime_Semacquire = function() {
		$panic("Native function not implemented: sync.runtime_Semacquire");
	};
	runtime_Semrelease = function() {
		$panic("Native function not implemented: sync.runtime_Semrelease");
	};
	init$1 = function() {
		var s;
		s = syncSema.zero(); $copy(s, syncSema.zero(), syncSema);
		runtime_Syncsemcheck(12);
	};
	$pkg.$init = function() {
		($ptrType(Pool)).methods = [["Get", "Get", "", $funcType([], [$emptyInterface], false), -1], ["Put", "Put", "", $funcType([$emptyInterface], [], false), -1], ["getSlow", "getSlow", "sync", $funcType([], [$emptyInterface], false), -1], ["pin", "pin", "sync", $funcType([], [($ptrType(poolLocal))], false), -1], ["pinSlow", "pinSlow", "sync", $funcType([], [($ptrType(poolLocal))], false), -1]];
		Pool.init([["local", "local", "sync", $UnsafePointer, ""], ["localSize", "localSize", "sync", $Uintptr, ""], ["store", "store", "sync", ($sliceType($emptyInterface)), ""], ["New", "New", "", ($funcType([], [$emptyInterface], false)), ""]]);
		($ptrType(Mutex)).methods = [["Lock", "Lock", "", $funcType([], [], false), -1], ["Unlock", "Unlock", "", $funcType([], [], false), -1]];
		Mutex.init([["state", "state", "sync", $Int32, ""], ["sema", "sema", "sync", $Uint32, ""]]);
		($ptrType(poolLocal)).methods = [["Lock", "Lock", "", $funcType([], [], false), 2], ["Unlock", "Unlock", "", $funcType([], [], false), 2]];
		poolLocal.init([["private$0", "private", "sync", $emptyInterface, ""], ["shared", "shared", "sync", ($sliceType($emptyInterface)), ""], ["Mutex", "", "", Mutex, ""], ["pad", "pad", "sync", ($arrayType($Uint8, 128)), ""]]);
		syncSema.init($Uintptr, 3);
		allPools = ($sliceType(($ptrType(Pool)))).nil;
		init();
		init$1();
	};
	return $pkg;
})();
$packages["math/rand"] = (function() {
	var $pkg = {}, math = $packages["math"], sync = $packages["sync"], Source, Rand, lockedSource, rngSource, ke, we, fe, kn, wn, fn, globalRand, rng_cooked, absInt32, NewSource, New, Intn, seedrand;
	Source = $pkg.Source = $newType(8, "Interface", "rand.Source", "Source", "math/rand", null);
	Rand = $pkg.Rand = $newType(0, "Struct", "rand.Rand", "Rand", "math/rand", function(src_) {
		this.$val = this;
		this.src = src_ !== undefined ? src_ : $ifaceNil;
	});
	lockedSource = $pkg.lockedSource = $newType(0, "Struct", "rand.lockedSource", "lockedSource", "math/rand", function(lk_, src_) {
		this.$val = this;
		this.lk = lk_ !== undefined ? lk_ : new sync.Mutex.Ptr();
		this.src = src_ !== undefined ? src_ : $ifaceNil;
	});
	rngSource = $pkg.rngSource = $newType(0, "Struct", "rand.rngSource", "rngSource", "math/rand", function(tap_, feed_, vec_) {
		this.$val = this;
		this.tap = tap_ !== undefined ? tap_ : 0;
		this.feed = feed_ !== undefined ? feed_ : 0;
		this.vec = vec_ !== undefined ? vec_ : ($arrayType($Int64, 607)).zero();
	});
	Rand.Ptr.prototype.ExpFloat64 = function() {
		var r, j, i, x, x$1;
		r = this;
		while (true) {
			j = r.Uint32();
			i = (j & 255) >>> 0;
			x = j * $coerceFloat32(((i < 0 || i >= we.length) ? $throwRuntimeError("index out of range") : we[i]));
			if (j < ((i < 0 || i >= ke.length) ? $throwRuntimeError("index out of range") : ke[i])) {
				return x;
			}
			if (i === 0) {
				return 7.69711747013105 - math.Log(r.Float64());
			}
			if (((i < 0 || i >= fe.length) ? $throwRuntimeError("index out of range") : fe[i]) + r.Float64() * ((x$1 = i - 1 >>> 0, ((x$1 < 0 || x$1 >= fe.length) ? $throwRuntimeError("index out of range") : fe[x$1])) - ((i < 0 || i >= fe.length) ? $throwRuntimeError("index out of range") : fe[i])) < math.Exp(-x)) {
				return x;
			}
		}
	};
	Rand.prototype.ExpFloat64 = function() { return this.$val.ExpFloat64(); };
	absInt32 = function(i) {
		if (i < 0) {
			return (-i >>> 0);
		}
		return (i >>> 0);
	};
	Rand.Ptr.prototype.NormFloat64 = function() {
		var r, j, i, x, y, x$1;
		r = this;
		while (true) {
			j = (r.Uint32() >> 0);
			i = j & 127;
			x = j * $coerceFloat32(((i < 0 || i >= wn.length) ? $throwRuntimeError("index out of range") : wn[i]));
			if (absInt32(j) < ((i < 0 || i >= kn.length) ? $throwRuntimeError("index out of range") : kn[i])) {
				return x;
			}
			if (i === 0) {
				while (true) {
					x = -math.Log(r.Float64()) * 0.29047645161474317;
					y = -math.Log(r.Float64());
					if (y + y >= x * x) {
						break;
					}
				}
				if (j > 0) {
					return 3.442619855899 + x;
				}
				return -3.442619855899 - x;
			}
			if (((i < 0 || i >= fn.length) ? $throwRuntimeError("index out of range") : fn[i]) + r.Float64() * ((x$1 = i - 1 >> 0, ((x$1 < 0 || x$1 >= fn.length) ? $throwRuntimeError("index out of range") : fn[x$1])) - ((i < 0 || i >= fn.length) ? $throwRuntimeError("index out of range") : fn[i])) < math.Exp(-0.5 * x * x)) {
				return x;
			}
		}
	};
	Rand.prototype.NormFloat64 = function() { return this.$val.NormFloat64(); };
	NewSource = $pkg.NewSource = function(seed) {
		var rng;
		rng = new rngSource.Ptr(); $copy(rng, new rngSource.Ptr(), rngSource);
		rng.Seed(seed);
		return rng;
	};
	New = $pkg.New = function(src) {
		return new Rand.Ptr(src);
	};
	Rand.Ptr.prototype.Seed = function(seed) {
		var r;
		r = this;
		r.src.Seed(seed);
	};
	Rand.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	Rand.Ptr.prototype.Int63 = function() {
		var r;
		r = this;
		return r.src.Int63();
	};
	Rand.prototype.Int63 = function() { return this.$val.Int63(); };
	Rand.Ptr.prototype.Uint32 = function() {
		var r;
		r = this;
		return ($shiftRightInt64(r.Int63(), 31).$low >>> 0);
	};
	Rand.prototype.Uint32 = function() { return this.$val.Uint32(); };
	Rand.Ptr.prototype.Int31 = function() {
		var r, x;
		r = this;
		return ((x = $shiftRightInt64(r.Int63(), 32), x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
	};
	Rand.prototype.Int31 = function() { return this.$val.Int31(); };
	Rand.Ptr.prototype.Int = function() {
		var r, u;
		r = this;
		u = (r.Int63().$low >>> 0);
		return (((u << 1 >>> 0) >>> 1 >>> 0) >> 0);
	};
	Rand.prototype.Int = function() { return this.$val.Int(); };
	Rand.Ptr.prototype.Int63n = function(n) {
		var r, x, x$1, x$2, x$3, x$4, x$5, max, v;
		r = this;
		if ((n.$high < 0 || (n.$high === 0 && n.$low <= 0))) {
			$panic(new $String("invalid argument to Int63n"));
		}
		if ((x = (x$1 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(n.$high & x$1.$high, (n.$low & x$1.$low) >>> 0)), (x.$high === 0 && x.$low === 0))) {
			return (x$2 = r.Int63(), x$3 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(x$2.$high & x$3.$high, (x$2.$low & x$3.$low) >>> 0));
		}
		max = (x$4 = (x$5 = $div64(new $Uint64(2147483648, 0), new $Uint64(n.$high, n.$low), true), new $Uint64(2147483647 - x$5.$high, 4294967295 - x$5.$low)), new $Int64(x$4.$high, x$4.$low));
		v = r.Int63();
		while ((v.$high > max.$high || (v.$high === max.$high && v.$low > max.$low))) {
			v = r.Int63();
		}
		return $div64(v, n, true);
	};
	Rand.prototype.Int63n = function(n) { return this.$val.Int63n(n); };
	Rand.Ptr.prototype.Int31n = function(n) {
		var r, _r, max, v, _r$1;
		r = this;
		if (n <= 0) {
			$panic(new $String("invalid argument to Int31n"));
		}
		if ((n & ((n - 1 >> 0))) === 0) {
			return r.Int31() & ((n - 1 >> 0));
		}
		max = ((2147483647 - (_r = 2147483648 % (n >>> 0), _r === _r ? _r : $throwRuntimeError("integer divide by zero")) >>> 0) >> 0);
		v = r.Int31();
		while (v > max) {
			v = r.Int31();
		}
		return (_r$1 = v % n, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero"));
	};
	Rand.prototype.Int31n = function(n) { return this.$val.Int31n(n); };
	Rand.Ptr.prototype.Intn = function(n) {
		var r, x;
		r = this;
		if (n <= 0) {
			$panic(new $String("invalid argument to Intn"));
		}
		if (n <= 2147483647) {
			return (r.Int31n((n >> 0)) >> 0);
		}
		return ((x = r.Int63n(new $Int64(0, n)), x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
	};
	Rand.prototype.Intn = function(n) { return this.$val.Intn(n); };
	Rand.Ptr.prototype.Float64 = function() {
		var r, f;
		r = this;
		f = $flatten64(r.Int63()) / 9.223372036854776e+18;
		if (f === 1) {
			f = 0;
		}
		return f;
	};
	Rand.prototype.Float64 = function() { return this.$val.Float64(); };
	Rand.Ptr.prototype.Float32 = function() {
		var r, f;
		r = this;
		f = r.Float64();
		if ($float32IsEqual(f, 1)) {
			f = 0;
		}
		return f;
	};
	Rand.prototype.Float32 = function() { return this.$val.Float32(); };
	Rand.Ptr.prototype.Perm = function(n) {
		var r, m, i, j;
		r = this;
		m = ($sliceType($Int)).make(n);
		i = 0;
		while (i < n) {
			j = r.Intn(i + 1 >> 0);
			(i < 0 || i >= m.$length) ? $throwRuntimeError("index out of range") : m.$array[m.$offset + i] = ((j < 0 || j >= m.$length) ? $throwRuntimeError("index out of range") : m.$array[m.$offset + j]);
			(j < 0 || j >= m.$length) ? $throwRuntimeError("index out of range") : m.$array[m.$offset + j] = i;
			i = i + (1) >> 0;
		}
		return m;
	};
	Rand.prototype.Perm = function(n) { return this.$val.Perm(n); };
	Intn = $pkg.Intn = function(n) {
		return globalRand.Intn(n);
	};
	lockedSource.Ptr.prototype.Int63 = function() {
		var n = new $Int64(0, 0), r;
		r = this;
		r.lk.Lock();
		n = r.src.Int63();
		r.lk.Unlock();
		return n;
	};
	lockedSource.prototype.Int63 = function() { return this.$val.Int63(); };
	lockedSource.Ptr.prototype.Seed = function(seed) {
		var r;
		r = this;
		r.lk.Lock();
		r.src.Seed(seed);
		r.lk.Unlock();
	};
	lockedSource.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	seedrand = function(x) {
		var _q, hi, _r, lo;
		hi = (_q = x / 44488, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		lo = (_r = x % 44488, _r === _r ? _r : $throwRuntimeError("integer divide by zero"));
		x = ((((48271 >>> 16 << 16) * lo >> 0) + (48271 << 16 >>> 16) * lo) >> 0) - ((((3399 >>> 16 << 16) * hi >> 0) + (3399 << 16 >>> 16) * hi) >> 0) >> 0;
		if (x < 0) {
			x = x + (2147483647) >> 0;
		}
		return x;
	};
	rngSource.Ptr.prototype.Seed = function(seed) {
		var rng, x, x$1, i, u, x$2, x$3, x$4, x$5;
		rng = this;
		rng.tap = 0;
		rng.feed = 334;
		seed = $div64(seed, new $Int64(0, 2147483647), true);
		if ((seed.$high < 0 || (seed.$high === 0 && seed.$low < 0))) {
			seed = (x = new $Int64(0, 2147483647), new $Int64(seed.$high + x.$high, seed.$low + x.$low));
		}
		if ((seed.$high === 0 && seed.$low === 0)) {
			seed = new $Int64(0, 89482311);
		}
		x$1 = ((seed.$low + ((seed.$high >> 31) * 4294967296)) >> 0);
		i = -20;
		while (i < 607) {
			x$1 = seedrand(x$1);
			if (i >= 0) {
				u = new $Int64(0, 0);
				u = $shiftLeft64(new $Int64(0, x$1), 40);
				x$1 = seedrand(x$1);
				u = (x$2 = $shiftLeft64(new $Int64(0, x$1), 20), new $Int64(u.$high ^ x$2.$high, (u.$low ^ x$2.$low) >>> 0));
				x$1 = seedrand(x$1);
				u = (x$3 = new $Int64(0, x$1), new $Int64(u.$high ^ x$3.$high, (u.$low ^ x$3.$low) >>> 0));
				u = (x$4 = ((i < 0 || i >= rng_cooked.length) ? $throwRuntimeError("index out of range") : rng_cooked[i]), new $Int64(u.$high ^ x$4.$high, (u.$low ^ x$4.$low) >>> 0));
				(x$5 = rng.vec, (i < 0 || i >= x$5.length) ? $throwRuntimeError("index out of range") : x$5[i] = new $Int64(u.$high & 2147483647, (u.$low & 4294967295) >>> 0));
			}
			i = i + (1) >> 0;
		}
	};
	rngSource.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	rngSource.Ptr.prototype.Int63 = function() {
		var rng, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		rng = this;
		rng.tap = rng.tap - (1) >> 0;
		if (rng.tap < 0) {
			rng.tap = rng.tap + (607) >> 0;
		}
		rng.feed = rng.feed - (1) >> 0;
		if (rng.feed < 0) {
			rng.feed = rng.feed + (607) >> 0;
		}
		x$7 = (x = (x$1 = (x$2 = rng.vec, x$3 = rng.feed, ((x$3 < 0 || x$3 >= x$2.length) ? $throwRuntimeError("index out of range") : x$2[x$3])), x$4 = (x$5 = rng.vec, x$6 = rng.tap, ((x$6 < 0 || x$6 >= x$5.length) ? $throwRuntimeError("index out of range") : x$5[x$6])), new $Int64(x$1.$high + x$4.$high, x$1.$low + x$4.$low)), new $Int64(x.$high & 2147483647, (x.$low & 4294967295) >>> 0));
		(x$8 = rng.vec, x$9 = rng.feed, (x$9 < 0 || x$9 >= x$8.length) ? $throwRuntimeError("index out of range") : x$8[x$9] = x$7);
		return x$7;
	};
	rngSource.prototype.Int63 = function() { return this.$val.Int63(); };
	$pkg.$init = function() {
		Source.init([["Int63", "Int63", "", $funcType([], [$Int64], false)], ["Seed", "Seed", "", $funcType([$Int64], [], false)]]);
		($ptrType(Rand)).methods = [["ExpFloat64", "ExpFloat64", "", $funcType([], [$Float64], false), -1], ["Float32", "Float32", "", $funcType([], [$Float32], false), -1], ["Float64", "Float64", "", $funcType([], [$Float64], false), -1], ["Int", "Int", "", $funcType([], [$Int], false), -1], ["Int31", "Int31", "", $funcType([], [$Int32], false), -1], ["Int31n", "Int31n", "", $funcType([$Int32], [$Int32], false), -1], ["Int63", "Int63", "", $funcType([], [$Int64], false), -1], ["Int63n", "Int63n", "", $funcType([$Int64], [$Int64], false), -1], ["Intn", "Intn", "", $funcType([$Int], [$Int], false), -1], ["NormFloat64", "NormFloat64", "", $funcType([], [$Float64], false), -1], ["Perm", "Perm", "", $funcType([$Int], [($sliceType($Int))], false), -1], ["Seed", "Seed", "", $funcType([$Int64], [], false), -1], ["Uint32", "Uint32", "", $funcType([], [$Uint32], false), -1]];
		Rand.init([["src", "src", "math/rand", Source, ""]]);
		($ptrType(lockedSource)).methods = [["Int63", "Int63", "", $funcType([], [$Int64], false), -1], ["Seed", "Seed", "", $funcType([$Int64], [], false), -1]];
		lockedSource.init([["lk", "lk", "math/rand", sync.Mutex, ""], ["src", "src", "math/rand", Source, ""]]);
		($ptrType(rngSource)).methods = [["Int63", "Int63", "", $funcType([], [$Int64], false), -1], ["Seed", "Seed", "", $funcType([$Int64], [], false), -1]];
		rngSource.init([["tap", "tap", "math/rand", $Int, ""], ["feed", "feed", "math/rand", $Int, ""], ["vec", "vec", "math/rand", ($arrayType($Int64, 607)), ""]]);
		ke = $toNativeArray("Uint32", [3801129273, 0, 2615860924, 3279400049, 3571300752, 3733536696, 3836274812, 3906990442, 3958562475, 3997804264, 4028649213, 4053523342, 4074002619, 4091154507, 4105727352, 4118261130, 4129155133, 4138710916, 4147160435, 4154685009, 4161428406, 4167506077, 4173011791, 4178022498, 4182601930, 4186803325, 4190671498, 4194244443, 4197554582, 4200629752, 4203493986, 4206168142, 4208670408, 4211016720, 4213221098, 4215295924, 4217252177, 4219099625, 4220846988, 4222502074, 4224071896, 4225562770, 4226980400, 4228329951, 4229616109, 4230843138, 4232014925, 4233135020, 4234206673, 4235232866, 4236216336, 4237159604, 4238064994, 4238934652, 4239770563, 4240574564, 4241348362, 4242093539, 4242811568, 4243503822, 4244171579, 4244816032, 4245438297, 4246039419, 4246620374, 4247182079, 4247725394, 4248251127, 4248760037, 4249252839, 4249730206, 4250192773, 4250641138, 4251075867, 4251497493, 4251906522, 4252303431, 4252688672, 4253062674, 4253425844, 4253778565, 4254121205, 4254454110, 4254777611, 4255092022, 4255397640, 4255694750, 4255983622, 4256264513, 4256537670, 4256803325, 4257061702, 4257313014, 4257557464, 4257795244, 4258026541, 4258251531, 4258470383, 4258683258, 4258890309, 4259091685, 4259287526, 4259477966, 4259663135, 4259843154, 4260018142, 4260188212, 4260353470, 4260514019, 4260669958, 4260821380, 4260968374, 4261111028, 4261249421, 4261383632, 4261513736, 4261639802, 4261761900, 4261880092, 4261994441, 4262105003, 4262211835, 4262314988, 4262414513, 4262510454, 4262602857, 4262691764, 4262777212, 4262859239, 4262937878, 4263013162, 4263085118, 4263153776, 4263219158, 4263281289, 4263340187, 4263395872, 4263448358, 4263497660, 4263543789, 4263586755, 4263626565, 4263663224, 4263696735, 4263727099, 4263754314, 4263778377, 4263799282, 4263817020, 4263831582, 4263842955, 4263851124, 4263856071, 4263857776, 4263856218, 4263851370, 4263843206, 4263831695, 4263816804, 4263798497, 4263776735, 4263751476, 4263722676, 4263690284, 4263654251, 4263614520, 4263571032, 4263523724, 4263472530, 4263417377, 4263358192, 4263294892, 4263227394, 4263155608, 4263079437, 4262998781, 4262913534, 4262823581, 4262728804, 4262629075, 4262524261, 4262414220, 4262298801, 4262177846, 4262051187, 4261918645, 4261780032, 4261635148, 4261483780, 4261325704, 4261160681, 4260988457, 4260808763, 4260621313, 4260425802, 4260221905, 4260009277, 4259787550, 4259556329, 4259315195, 4259063697, 4258801357, 4258527656, 4258242044, 4257943926, 4257632664, 4257307571, 4256967906, 4256612870, 4256241598, 4255853155, 4255446525, 4255020608, 4254574202, 4254106002, 4253614578, 4253098370, 4252555662, 4251984571, 4251383021, 4250748722, 4250079132, 4249371435, 4248622490, 4247828790, 4246986404, 4246090910, 4245137315, 4244119963, 4243032411, 4241867296, 4240616155, 4239269214, 4237815118, 4236240596, 4234530035, 4232664930, 4230623176, 4228378137, 4225897409, 4223141146, 4220059768, 4216590757, 4212654085, 4208145538, 4202926710, 4196809522, 4189531420, 4180713890, 4169789475, 4155865042, 4137444620, 4111806704, 4073393724, 4008685917, 3873074895]);
		we = $toNativeArray("Float32", [2.0249555365836613e-09, 1.4866739783681027e-11, 2.4409616689036184e-11, 3.1968806074589295e-11, 3.844677007314168e-11, 4.42282044321729e-11, 4.951644302919611e-11, 5.443358958023836e-11, 5.905943789574764e-11, 6.34494193296753e-11, 6.764381416113352e-11, 7.167294535648239e-11, 7.556032188826833e-11, 7.932458162551725e-11, 8.298078890689453e-11, 8.654132271912474e-11, 9.001651507523079e-11, 9.341507428706208e-11, 9.674443190998971e-11, 1.0001099254308699e-10, 1.0322031424037093e-10, 1.0637725422757427e-10, 1.0948611461891744e-10, 1.1255067711157807e-10, 1.1557434870246297e-10, 1.1856014781042035e-10, 1.2151082917633005e-10, 1.2442885610752796e-10, 1.2731647680563896e-10, 1.3017574518325858e-10, 1.330085347417409e-10, 1.3581656632677408e-10, 1.386014220061682e-10, 1.413645728254309e-10, 1.4410737880776736e-10, 1.4683107507629245e-10, 1.4953686899854546e-10, 1.522258291641876e-10, 1.5489899640730442e-10, 1.575573282952547e-10, 1.6020171300645814e-10, 1.628330109637588e-10, 1.6545202707884954e-10, 1.68059510752272e-10, 1.7065616975120435e-10, 1.73242697965037e-10, 1.758197337720091e-10, 1.783878739169964e-10, 1.8094774290045024e-10, 1.834998542005195e-10, 1.8604476292871652e-10, 1.8858298256319017e-10, 1.9111498494872592e-10, 1.9364125580789704e-10, 1.9616222535212557e-10, 1.9867835154840918e-10, 2.011900368525943e-10, 2.0369768372052732e-10, 2.062016807302669e-10, 2.0870240258208383e-10, 2.1120022397624894e-10, 2.136955057352452e-10, 2.1618855317040442e-10, 2.1867974098199738e-10, 2.2116936060356807e-10, 2.2365774510202385e-10, 2.2614519978869652e-10, 2.2863201609713002e-10, 2.3111849933865614e-10, 2.3360494094681883e-10, 2.3609159072179864e-10, 2.3857874009713953e-10, 2.4106666662859766e-10, 2.4355562011635357e-10, 2.460458781161634e-10, 2.485376904282077e-10, 2.5103127909709144e-10, 2.5352694943414633e-10, 2.560248957284017e-10, 2.585253955356137e-10, 2.610286709003873e-10, 2.6353494386732734e-10, 2.6604446423661443e-10, 2.6855745405285347e-10, 2.71074163116225e-10, 2.7359478571575835e-10, 2.7611959940720965e-10, 2.786487707240326e-10, 2.8118254946640775e-10, 2.8372118543451563e-10, 2.8626484516180994e-10, 2.8881380620404684e-10, 2.9136826285025563e-10, 2.9392840938946563e-10, 2.96494523377433e-10, 2.990667713476114e-10, 3.016454031001814e-10, 3.042306406797479e-10, 3.068226783753403e-10, 3.09421765987139e-10, 3.12028125559749e-10, 3.1464195138219964e-10, 3.17263521010247e-10, 3.1989300097734485e-10, 3.225306410836737e-10, 3.2517669112941405e-10, 3.2783134540359526e-10, 3.3049485370639786e-10, 3.3316743808242677e-10, 3.3584937608743815e-10, 3.385408342548857e-10, 3.4124211789610115e-10, 3.4395342130011386e-10, 3.4667499426710435e-10, 3.494071143528288e-10, 3.521500313574677e-10, 3.54903967325626e-10, 3.576691720574843e-10, 3.6044595086437425e-10, 3.632345535464765e-10, 3.660352021483959e-10, 3.688482297370399e-10, 3.716738583570134e-10, 3.7451239331964814e-10, 3.773641121807003e-10, 3.802292924959261e-10, 3.831082673322328e-10, 3.8600128648980103e-10, 3.8890865527996255e-10, 3.9183070676962473e-10, 3.9476774627011935e-10, 3.977200790927782e-10, 4.006880383045086e-10, 4.0367195697221803e-10, 4.066721681628138e-10, 4.0968900494320337e-10, 4.127228558914453e-10, 4.15774054074447e-10, 4.188429603146915e-10, 4.2192993543466173e-10, 4.25035395767992e-10, 4.2815970213716525e-10, 4.313032986313914e-10, 4.3446651831757777e-10, 4.376498607960855e-10, 4.408536868893975e-10, 4.4407846844229937e-10, 4.4732464954400086e-10, 4.5059267428371186e-10, 4.538830145062178e-10, 4.5719619756745544e-10, 4.605326675566346e-10, 4.638929240741163e-10, 4.672775499869886e-10, 4.706869893844612e-10, 4.74121908400349e-10, 4.775827511238617e-10, 4.810701836888143e-10, 4.845848167178701e-10, 4.881271498113904e-10, 4.916979601254923e-10, 4.952977472605369e-10, 4.989272883726414e-10, 5.025872495956207e-10, 5.062783525744408e-10, 5.100013189540675e-10, 5.13756870379467e-10, 5.175458395179078e-10, 5.21369003525507e-10, 5.252272505806843e-10, 5.29121357839557e-10, 5.330522134805449e-10, 5.3702081670437e-10, 5.41028055689452e-10, 5.450749851476644e-10, 5.491624932574268e-10, 5.532918012640664e-10, 5.574638528571541e-10, 5.616799247931681e-10, 5.659410717839819e-10, 5.702485705860738e-10, 5.746036979559221e-10, 5.790077306500052e-10, 5.83462111958255e-10, 5.879682296594524e-10, 5.925275825546805e-10, 5.971417249561739e-10, 6.01812211176167e-10, 6.065408175714992e-10, 6.113292094767075e-10, 6.16179329782085e-10, 6.21092954844471e-10, 6.260721940876124e-10, 6.311191569352559e-10, 6.362359528111483e-10, 6.414249686947926e-10, 6.466885360545405e-10, 6.520292639144998e-10, 6.574497612987784e-10, 6.629528592760892e-10, 6.685415554485985e-10, 6.742187919073217e-10, 6.799880103436351e-10, 6.858525969377638e-10, 6.918161599145378e-10, 6.978825850545434e-10, 7.040559801829716e-10, 7.103406751696184e-10, 7.167412219288849e-10, 7.232625609532306e-10, 7.2990985477972e-10, 7.366885990123251e-10, 7.436047333442275e-10, 7.506645305355164e-10, 7.57874762946642e-10, 7.652426470272644e-10, 7.727759543385559e-10, 7.804830115532013e-10, 7.883728114777e-10, 7.964550685635174e-10, 8.047402189070851e-10, 8.132396422944055e-10, 8.219657177122031e-10, 8.309318788590758e-10, 8.401527806789488e-10, 8.496445214056791e-10, 8.594246980742071e-10, 8.695127395874636e-10, 8.799300732498239e-10, 8.90700457834015e-10, 9.01850316648023e-10, 9.134091816243028e-10, 9.254100818978372e-10, 9.37890431984556e-10, 9.508922538259412e-10, 9.64463842123564e-10, 9.78660263939446e-10, 9.935448019859905e-10, 1.0091912860943353e-09, 1.0256859805934937e-09, 1.0431305819125214e-09, 1.0616465484503124e-09, 1.0813799855569073e-09, 1.1025096391392708e-09, 1.1252564435793033e-09, 1.149898620766976e-09, 1.176793218427008e-09, 1.2064089727203964e-09, 1.2393785997488749e-09, 1.2765849488616254e-09, 1.319313880365769e-09, 1.36954347862428e-09, 1.4305497897382224e-09, 1.5083649884672923e-09, 1.6160853766322703e-09, 1.7921247819074893e-09]);
		fe = $toNativeArray("Float32", [1, 0.9381436705589294, 0.900469958782196, 0.8717043399810791, 0.847785472869873, 0.8269932866096497, 0.8084216713905334, 0.7915276288986206, 0.7759568691253662, 0.7614634037017822, 0.7478685975074768, 0.7350381016731262, 0.7228676676750183, 0.7112747430801392, 0.7001926302909851, 0.6895664930343628, 0.6793505549430847, 0.669506311416626, 0.6600008606910706, 0.6508058309555054, 0.6418967247009277, 0.633251965045929, 0.62485271692276, 0.6166821718215942, 0.608725368976593, 0.6009689569473267, 0.5934008955955505, 0.5860103368759155, 0.5787873864173889, 0.5717230439186096, 0.5648092031478882, 0.5580382943153381, 0.5514034032821655, 0.5448982119560242, 0.5385168790817261, 0.5322538614273071, 0.526104211807251, 0.5200631618499756, 0.5141264200210571, 0.5082897543907166, 0.5025495290756226, 0.4969019889831543, 0.4913438558578491, 0.4858720004558563, 0.48048335313796997, 0.4751752018928528, 0.4699448347091675, 0.4647897481918335, 0.4597076177597046, 0.4546961486339569, 0.4497532546520233, 0.44487687945365906, 0.4400651156902313, 0.4353161156177521, 0.4306281507015228, 0.42599955201148987, 0.42142874002456665, 0.4169141948223114, 0.4124544560909271, 0.40804818272590637, 0.4036940038204193, 0.39939069747924805, 0.3951369822025299, 0.39093172550201416, 0.38677382469177246, 0.38266217708587646, 0.378595769405365, 0.37457355856895447, 0.37059465050697327, 0.366658091545105, 0.362762987613678, 0.358908474445343, 0.35509374737739563, 0.35131800174713135, 0.3475804924964905, 0.34388044476509094, 0.34021714329719543, 0.33658990263938904, 0.3329980671405792, 0.3294409513473511, 0.32591795921325684, 0.32242849469184875, 0.3189719021320343, 0.3155476748943329, 0.31215524673461914, 0.3087940812110901, 0.30546361207962036, 0.30216339230537415, 0.29889291524887085, 0.29565170407295227, 0.2924392819404602, 0.2892552316188812, 0.28609907627105713, 0.2829704284667969, 0.27986884117126465, 0.2767939269542694, 0.2737452983856201, 0.2707225978374481, 0.26772540807724, 0.26475343108177185, 0.2618062496185303, 0.258883535861969, 0.2559850215911865, 0.25311028957366943, 0.25025907158851624, 0.24743106961250305, 0.2446259707212448, 0.24184346199035645, 0.23908329010009766, 0.23634515702724457, 0.2336287796497345, 0.23093391954898834, 0.22826029360294342, 0.22560766339302063, 0.22297576069831848, 0.22036437690258026, 0.21777324378490448, 0.21520215272903442, 0.212650865316391, 0.21011915802955627, 0.20760682225227356, 0.20511364936828613, 0.20263944566249847, 0.20018397271633148, 0.19774706661701202, 0.1953285187482834, 0.19292815029621124, 0.19054576754570007, 0.18818120658397675, 0.18583425879478455, 0.18350479006767273, 0.18119260668754578, 0.17889754474163055, 0.17661945521831512, 0.17435817420482635, 0.1721135377883911, 0.16988539695739746, 0.16767361760139465, 0.16547803580760956, 0.16329853236675262, 0.16113494336605072, 0.1589871346950531, 0.15685498714447021, 0.15473836660385132, 0.15263713896274567, 0.1505511850118637, 0.1484803706407547, 0.14642459154129028, 0.1443837285041809, 0.14235764741897583, 0.1403462439775467, 0.13834942877292633, 0.136367067694664, 0.13439907133579254, 0.1324453204870224, 0.1305057406425476, 0.12858019769191742, 0.12666863203048706, 0.12477091699838638, 0.12288697808980942, 0.1210167184472084, 0.11916005611419678, 0.11731690168380737, 0.11548716574907303, 0.11367076635360718, 0.11186762899160385, 0.11007767915725708, 0.1083008274435997, 0.10653700679540634, 0.10478614270687103, 0.1030481606721878, 0.10132300108671188, 0.0996105819940567, 0.09791085124015808, 0.09622374176979065, 0.09454918652772903, 0.09288713335990906, 0.09123751521110535, 0.08960027992725372, 0.08797537535429001, 0.08636274188756943, 0.0847623273730278, 0.08317409455776215, 0.08159798383712769, 0.08003395050764084, 0.07848194986581802, 0.07694194465875626, 0.07541389018297195, 0.07389774918556213, 0.07239348441362381, 0.070901058614254, 0.06942043453454971, 0.06795158982276917, 0.06649449467658997, 0.06504911929368973, 0.06361543387174606, 0.06219341605901718, 0.06078304722905159, 0.0593843050301075, 0.05799717456102371, 0.05662164092063904, 0.05525768920779228, 0.05390531197190285, 0.05256449431180954, 0.05123523622751236, 0.04991753399372101, 0.04861138388514519, 0.047316793352365494, 0.04603376239538193, 0.044762298464775085, 0.04350241273641586, 0.04225412383675575, 0.04101744294166565, 0.039792392402887344, 0.03857899457216263, 0.03737728297710419, 0.03618728369474411, 0.03500903770327568, 0.03384258225560188, 0.0326879620552063, 0.031545232981443405, 0.030414443463087082, 0.0292956605553627, 0.028188949450850487, 0.027094384655356407, 0.02601204626262188, 0.024942025542259216, 0.023884421214461327, 0.022839335724711418, 0.021806888282299042, 0.020787203684449196, 0.019780423492193222, 0.018786700442433357, 0.017806200310587883, 0.016839107498526573, 0.015885621309280396, 0.014945968054234982, 0.01402039173990488, 0.013109165243804455, 0.012212592177093029, 0.011331013403832912, 0.010464809834957123, 0.009614413604140282, 0.008780314587056637, 0.007963077165186405, 0.007163353264331818, 0.0063819061033427715, 0.005619642324745655, 0.004877655766904354, 0.004157294984906912, 0.003460264764726162, 0.0027887988835573196, 0.0021459676790982485, 0.001536299823783338, 0.0009672692976891994, 0.0004541343660093844]);
		kn = $toNativeArray("Uint32", [1991057938, 0, 1611602771, 1826899878, 1918584482, 1969227037, 2001281515, 2023368125, 2039498179, 2051788381, 2061460127, 2069267110, 2075699398, 2081089314, 2085670119, 2089610331, 2093034710, 2096037586, 2098691595, 2101053571, 2103168620, 2105072996, 2106796166, 2108362327, 2109791536, 2111100552, 2112303493, 2113412330, 2114437283, 2115387130, 2116269447, 2117090813, 2117856962, 2118572919, 2119243101, 2119871411, 2120461303, 2121015852, 2121537798, 2122029592, 2122493434, 2122931299, 2123344971, 2123736059, 2124106020, 2124456175, 2124787725, 2125101763, 2125399283, 2125681194, 2125948325, 2126201433, 2126441213, 2126668298, 2126883268, 2127086657, 2127278949, 2127460589, 2127631985, 2127793506, 2127945490, 2128088244, 2128222044, 2128347141, 2128463758, 2128572095, 2128672327, 2128764606, 2128849065, 2128925811, 2128994934, 2129056501, 2129110560, 2129157136, 2129196237, 2129227847, 2129251929, 2129268426, 2129277255, 2129278312, 2129271467, 2129256561, 2129233410, 2129201800, 2129161480, 2129112170, 2129053545, 2128985244, 2128906855, 2128817916, 2128717911, 2128606255, 2128482298, 2128345305, 2128194452, 2128028813, 2127847342, 2127648860, 2127432031, 2127195339, 2126937058, 2126655214, 2126347546, 2126011445, 2125643893, 2125241376, 2124799783, 2124314271, 2123779094, 2123187386, 2122530867, 2121799464, 2120980787, 2120059418, 2119015917, 2117825402, 2116455471, 2114863093, 2112989789, 2110753906, 2108037662, 2104664315, 2100355223, 2094642347, 2086670106, 2074676188, 2054300022, 2010539237]);
		wn = $toNativeArray("Float32", [1.7290404663583558e-09, 1.2680928529462676e-10, 1.689751810696194e-10, 1.9862687883343e-10, 2.223243117382978e-10, 2.4244936613904144e-10, 2.601613091623989e-10, 2.761198769629658e-10, 2.9073962681813725e-10, 3.042996965518796e-10, 3.169979556627567e-10, 3.289802041894774e-10, 3.4035738116777736e-10, 3.5121602848242617e-10, 3.61625090983253e-10, 3.7164057942185025e-10, 3.813085680537398e-10, 3.906675816178762e-10, 3.997501218933053e-10, 4.0858399996679395e-10, 4.1719308563337165e-10, 4.255982233303257e-10, 4.3381759295968436e-10, 4.4186720948857783e-10, 4.497613115272969e-10, 4.57512583373898e-10, 4.6513240481438345e-10, 4.726310454117311e-10, 4.800177477726209e-10, 4.873009773476156e-10, 4.944885056978876e-10, 5.015873272284921e-10, 5.086040477664255e-10, 5.155446070048697e-10, 5.224146670812502e-10, 5.292193350214802e-10, 5.359634958068682e-10, 5.426517013518151e-10, 5.492881705038144e-10, 5.558769555769061e-10, 5.624218868405251e-10, 5.689264614971989e-10, 5.75394121238304e-10, 5.818281967329142e-10, 5.882316855831959e-10, 5.946076964136182e-10, 6.009590047817426e-10, 6.072883862451306e-10, 6.135985053390414e-10, 6.19892026598734e-10, 6.261713370037114e-10, 6.324390455780815e-10, 6.386973727678935e-10, 6.449488165749528e-10, 6.511955974453087e-10, 6.574400468473129e-10, 6.636843297158634e-10, 6.699307220081607e-10, 6.761814441702541e-10, 6.824387166481927e-10, 6.887046488657234e-10, 6.949815167800466e-10, 7.012714853260604e-10, 7.075767749498141e-10, 7.13899661608508e-10, 7.202424212593428e-10, 7.266072743483676e-10, 7.329966078550854e-10, 7.394128087589991e-10, 7.458582640396116e-10, 7.523354716987285e-10, 7.588469852493063e-10, 7.653954137154528e-10, 7.719834771435785e-10, 7.786139510912449e-10, 7.852897221383159e-10, 7.920137878869582e-10, 7.987892014504894e-10, 8.056192379868321e-10, 8.125072836762115e-10, 8.194568912323064e-10, 8.264716688799467e-10, 8.3355555791087e-10, 8.407127216614185e-10, 8.479473234679347e-10, 8.552640262671218e-10, 8.626675485068347e-10, 8.701631637464402e-10, 8.777562010564566e-10, 8.854524335966119e-10, 8.932581896381464e-10, 9.011799639857543e-10, 9.092249730890956e-10, 9.174008219758889e-10, 9.25715837318819e-10, 9.341788453909317e-10, 9.42799727177146e-10, 9.515889187738935e-10, 9.605578554783278e-10, 9.697193048552322e-10, 9.790869226478094e-10, 9.886760299337993e-10, 9.985036131254788e-10, 1.008588212947359e-09, 1.0189509236369076e-09, 1.0296150598776421e-09, 1.040606933955246e-09, 1.0519566329136865e-09, 1.0636980185552147e-09, 1.0758701707302976e-09, 1.0885182755160372e-09, 1.101694735439196e-09, 1.115461056855338e-09, 1.1298901814171813e-09, 1.1450695946990663e-09, 1.1611052119775422e-09, 1.178127595480305e-09, 1.1962995039027646e-09, 1.2158286599728285e-09, 1.2369856250415978e-09, 1.2601323318151003e-09, 1.2857697129220469e-09, 1.3146201904845611e-09, 1.3477839955200466e-09, 1.3870635751089821e-09, 1.43574030442295e-09, 1.5008658760251592e-09, 1.6030947680434338e-09]);
		fn = $toNativeArray("Float32", [1, 0.963599681854248, 0.9362826943397522, 0.9130436182022095, 0.8922816514968872, 0.8732430338859558, 0.8555005788803101, 0.8387836217880249, 0.8229072093963623, 0.8077383041381836, 0.7931770086288452, 0.7791460752487183, 0.7655841708183289, 0.7524415850639343, 0.7396772503852844, 0.7272568941116333, 0.7151514887809753, 0.7033361196517944, 0.6917891502380371, 0.6804918646812439, 0.6694276928901672, 0.6585819721221924, 0.6479418277740479, 0.6374954581260681, 0.6272324919700623, 0.6171433925628662, 0.6072195172309875, 0.5974531769752502, 0.5878370404243469, 0.5783646702766418, 0.5690299868583679, 0.5598273873329163, 0.550751805305481, 0.5417983531951904, 0.5329626798629761, 0.5242405533790588, 0.5156282186508179, 0.5071220397949219, 0.49871864914894104, 0.4904148280620575, 0.48220765590667725, 0.47409430146217346, 0.466072142124176, 0.45813870429992676, 0.45029163360595703, 0.44252872467041016, 0.4348478317260742, 0.42724698781967163, 0.41972434520721436, 0.41227802634239197, 0.40490642189979553, 0.39760786294937134, 0.3903807997703552, 0.3832238018512726, 0.3761354684829712, 0.3691144585609436, 0.36215949058532715, 0.3552693724632263, 0.3484429717063904, 0.3416791558265686, 0.33497685194015503, 0.32833510637283325, 0.3217529058456421, 0.3152293860912323, 0.30876362323760986, 0.3023548424243927, 0.2960021495819092, 0.2897048592567444, 0.28346219658851624, 0.2772735059261322, 0.271138072013855, 0.2650552988052368, 0.25902456045150757, 0.25304529070854187, 0.24711695313453674, 0.24123899638652802, 0.23541094362735748, 0.22963231801986694, 0.22390270233154297, 0.21822164952754974, 0.21258877217769623, 0.20700371265411377, 0.20146611332893372, 0.1959756463766098, 0.19053204357624054, 0.18513499200344086, 0.17978426814079285, 0.1744796335697174, 0.16922089457511902, 0.16400785744190216, 0.1588403731584549, 0.15371830761432648, 0.14864157140254974, 0.14361007511615753, 0.13862377405166626, 0.13368265330791473, 0.12878671288490295, 0.12393598258495331, 0.11913054436445236, 0.11437050998210907, 0.10965602099895477, 0.1049872562289238, 0.10036443918943405, 0.09578784555196762, 0.09125780314207077, 0.08677466958761215, 0.08233889937400818, 0.07795098423957825, 0.07361150532960892, 0.06932111829519272, 0.06508058309555054, 0.06089077144861221, 0.05675266310572624, 0.05266740173101425, 0.048636294901371, 0.044660862535238266, 0.040742866694927216, 0.03688438981771469, 0.03308788686990738, 0.029356317594647408, 0.025693291798233986, 0.02210330404341221, 0.018592102453112602, 0.015167297795414925, 0.011839478276669979, 0.0086244847625494, 0.005548994988203049, 0.0026696291752159595]);
		rng_cooked = $toNativeArray("Int64", [new $Int64(1173834291, 3952672746), new $Int64(1081821761, 3130416987), new $Int64(324977939, 3414273807), new $Int64(1241840476, 2806224363), new $Int64(669549340, 1997590414), new $Int64(2103305448, 2402795971), new $Int64(1663160183, 1140819369), new $Int64(1120601685, 1788868961), new $Int64(1848035537, 1089001426), new $Int64(1235702047, 873593504), new $Int64(1911387977, 581324885), new $Int64(492609478, 1609182556), new $Int64(1069394745, 1241596776), new $Int64(1895445337, 1771189259), new $Int64(772864846, 3467012610), new $Int64(2006957225, 2344407434), new $Int64(402115761, 782467244), new $Int64(26335124, 3404933915), new $Int64(1063924276, 618867887), new $Int64(1178782866, 520164395), new $Int64(555910815, 1341358184), new $Int64(632398609, 665794848), new $Int64(1527227641, 3183648150), new $Int64(1781176124, 696329606), new $Int64(1789146075, 4151988961), new $Int64(60039534, 998951326), new $Int64(1535158725, 1364957564), new $Int64(63173359, 4090230633), new $Int64(649454641, 4009697548), new $Int64(248009524, 2569622517), new $Int64(778703922, 3742421481), new $Int64(1038377625, 1506914633), new $Int64(1738099768, 1983412561), new $Int64(236311649, 1436266083), new $Int64(1035966148, 3922894967), new $Int64(810508934, 1792680179), new $Int64(563141142, 1188796351), new $Int64(1349617468, 405968250), new $Int64(1044074554, 433754187), new $Int64(870549669, 4073162024), new $Int64(1053232044, 433121399), new $Int64(2451824, 4162580594), new $Int64(2010221076, 4132415622), new $Int64(611252600, 3033822028), new $Int64(2016407895, 824682382), new $Int64(2366218, 3583765414), new $Int64(1522878809, 535386927), new $Int64(1637219058, 2286693689), new $Int64(1453075389, 2968466525), new $Int64(193683513, 1351410206), new $Int64(1863677552, 1412813499), new $Int64(492736522, 4126267639), new $Int64(512765208, 2105529399), new $Int64(2132966268, 2413882233), new $Int64(947457634, 32226200), new $Int64(1149341356, 2032329073), new $Int64(106485445, 1356518208), new $Int64(79673492, 3430061722), new $Int64(663048513, 3820169661), new $Int64(481498454, 2981816134), new $Int64(1017155588, 4184371017), new $Int64(206574701, 2119206761), new $Int64(1295374591, 2472200560), new $Int64(1587026100, 2853524696), new $Int64(1307803389, 1681119904), new $Int64(1972496813, 95608918), new $Int64(392686347, 3690479145), new $Int64(941912722, 1397922290), new $Int64(988169623, 1516129515), new $Int64(1827305493, 1547420459), new $Int64(1311333971, 1470949486), new $Int64(194013850, 1336785672), new $Int64(2102397034, 4131677129), new $Int64(755205548, 4246329084), new $Int64(1004983461, 3788585631), new $Int64(2081005363, 3080389532), new $Int64(1501045284, 2215402037), new $Int64(391002300, 1171593935), new $Int64(1408774047, 1423855166), new $Int64(1628305930, 2276716302), new $Int64(1779030508, 2068027241), new $Int64(1369359303, 3427553297), new $Int64(189241615, 3289637845), new $Int64(1057480830, 3486407650), new $Int64(634572984, 3071877822), new $Int64(1159653919, 3363620705), new $Int64(1213226718, 4159821533), new $Int64(2070861710, 1894661), new $Int64(1472989750, 1156868282), new $Int64(348271067, 776219088), new $Int64(1646054810, 2425634259), new $Int64(1716021749, 680510161), new $Int64(1573220192, 1310101429), new $Int64(1095885995, 2964454134), new $Int64(1821788136, 3467098407), new $Int64(1990672920, 2109628894), new $Int64(7834944, 1232604732), new $Int64(309412934, 3261916179), new $Int64(1699175360, 434597899), new $Int64(235436061, 1624796439), new $Int64(521080809, 3589632480), new $Int64(1198416575, 864579159), new $Int64(208735487, 1380889830), new $Int64(619206309, 2654509477), new $Int64(1419738251, 1468209306), new $Int64(403198876, 100794388), new $Int64(956062190, 2991674471), new $Int64(1938816907, 2224662036), new $Int64(1973824487, 977097250), new $Int64(1351320195, 726419512), new $Int64(1964023751, 1747974366), new $Int64(1394388465, 1556430604), new $Int64(1097991433, 1080776742), new $Int64(1761636690, 280794874), new $Int64(117767733, 919835643), new $Int64(1180474222, 3434019658), new $Int64(196069168, 2461941785), new $Int64(133215641, 3615001066), new $Int64(417204809, 3103414427), new $Int64(790056561, 3380809712), new $Int64(879802240, 2724693469), new $Int64(547796833, 598827710), new $Int64(300924196, 3452273442), new $Int64(2071705424, 649274915), new $Int64(1346182319, 2585724112), new $Int64(636549385, 3165579553), new $Int64(1185578221, 2635894283), new $Int64(2094573470, 2053289721), new $Int64(985976581, 3169337108), new $Int64(1170569632, 144717764), new $Int64(1079216270, 1383666384), new $Int64(2022678706, 681540375), new $Int64(1375448925, 537050586), new $Int64(182715304, 315246468), new $Int64(226402871, 849323088), new $Int64(1262421183, 45543944), new $Int64(1201038398, 2319052083), new $Int64(2106775454, 3613090841), new $Int64(560472520, 2992171180), new $Int64(1765620479, 2068244785), new $Int64(917538188, 4239862634), new $Int64(777927839, 3892253031), new $Int64(720683925, 958186149), new $Int64(1724185863, 1877702262), new $Int64(1357886971, 837674867), new $Int64(1837048883, 1507589294), new $Int64(1905518400, 873336795), new $Int64(267722611, 2764496274), new $Int64(341003118, 4196182374), new $Int64(1080717893, 550964545), new $Int64(818747069, 420611474), new $Int64(222653272, 204265180), new $Int64(1549974541, 1787046383), new $Int64(1215581865, 3102292318), new $Int64(418321538, 1552199393), new $Int64(1243493047, 980542004), new $Int64(267284263, 3293718720), new $Int64(1179528763, 3771917473), new $Int64(599484404, 2195808264), new $Int64(252818753, 3894702887), new $Int64(780007692, 2099949527), new $Int64(1424094358, 338442522), new $Int64(490737398, 637158004), new $Int64(419862118, 281976339), new $Int64(574970164, 3619802330), new $Int64(1715552825, 3084554784), new $Int64(882872465, 4129772886), new $Int64(43084605, 1680378557), new $Int64(525521057, 3339087776), new $Int64(1680500332, 4220317857), new $Int64(211654685, 2959322499), new $Int64(1675600481, 1488354890), new $Int64(1312620086, 3958162143), new $Int64(920972075, 2773705983), new $Int64(1876039582, 225908689), new $Int64(963748535, 908216283), new $Int64(1541787429, 3574646075), new $Int64(319760557, 1936937569), new $Int64(1519770881, 75492235), new $Int64(816689472, 1935193178), new $Int64(2142521206, 2018250883), new $Int64(455141620, 3943126022), new $Int64(1546084160, 3066544345), new $Int64(1932392669, 2793082663), new $Int64(908474287, 3297036421), new $Int64(1640597065, 2206987825), new $Int64(1594236910, 807894872), new $Int64(366158341, 766252117), new $Int64(2060649606, 3833114345), new $Int64(845619743, 1255067973), new $Int64(1201145605, 741697208), new $Int64(671241040, 2810093753), new $Int64(1109032642, 4229340371), new $Int64(1462188720, 1361684224), new $Int64(988084219, 1906263026), new $Int64(475781207, 3904421704), new $Int64(1523946520, 1769075545), new $Int64(1062308525, 2621599764), new $Int64(1279509432, 3431891480), new $Int64(404732502, 1871896503), new $Int64(128756421, 1412808876), new $Int64(1605404688, 952876175), new $Int64(1917039957, 1824438899), new $Int64(1662295856, 1005035476), new $Int64(1990909507, 527508597), new $Int64(1288873303, 3066806859), new $Int64(565995893, 3244940914), new $Int64(1257737460, 209092916), new $Int64(1899814242, 1242699167), new $Int64(1433653252, 456723774), new $Int64(1776978905, 1001252870), new $Int64(1468772157, 2026725874), new $Int64(857254202, 2137562569), new $Int64(765939740, 3183366709), new $Int64(1533887628, 2612072960), new $Int64(56977098, 1727148468), new $Int64(949899753, 3803658212), new $Int64(1883670356, 479946959), new $Int64(685713571, 1562982345), new $Int64(201241205, 1766109365), new $Int64(700596547, 3257093788), new $Int64(1962768719, 2365720207), new $Int64(93384808, 3742754173), new $Int64(1689098413, 2878193673), new $Int64(1096135042, 2174002182), new $Int64(1313222695, 3573511231), new $Int64(1392911121, 1760299077), new $Int64(771856457, 2260779833), new $Int64(1281464374, 1452805722), new $Int64(917811730, 2940011802), new $Int64(1890251082, 1886183802), new $Int64(893897673, 2514369088), new $Int64(1644345561, 3924317791), new $Int64(172616216, 500935732), new $Int64(1403501753, 676580929), new $Int64(581571365, 1184984890), new $Int64(1455515235, 1271474274), new $Int64(318728910, 3163791473), new $Int64(2051027584, 2842487377), new $Int64(1511537551, 2170968612), new $Int64(573262976, 3535856740), new $Int64(94256461, 1488599718), new $Int64(966951817, 3408913763), new $Int64(60951736, 2501050084), new $Int64(1272353200, 1639124157), new $Int64(138001144, 4088176393), new $Int64(1574896563, 3989947576), new $Int64(1982239940, 3414355209), new $Int64(1355154361, 2275136352), new $Int64(89709303, 2151835223), new $Int64(1216338715, 1654534827), new $Int64(1467562197, 377892833), new $Int64(1664767638, 660204544), new $Int64(85706799, 390828249), new $Int64(725310955, 3402783878), new $Int64(678849488, 3717936603), new $Int64(1113532086, 2211058823), new $Int64(1564224320, 2692150867), new $Int64(1952770442, 1928910388), new $Int64(788716862, 3931011137), new $Int64(1083670504, 1112701047), new $Int64(2079333076, 2452299106), new $Int64(1251318826, 2337204777), new $Int64(1774877857, 273889282), new $Int64(1798719843, 1462008793), new $Int64(2138834788, 1554494002), new $Int64(952516517, 182675323), new $Int64(548928884, 1882802136), new $Int64(589279648, 3700220025), new $Int64(381039426, 3083431543), new $Int64(1295624457, 3622207527), new $Int64(338126939, 432729309), new $Int64(480013522, 2391914317), new $Int64(297925497, 235747924), new $Int64(2120733629, 3088823825), new $Int64(1402403853, 2314658321), new $Int64(1165929723, 2957634338), new $Int64(501323675, 4117056981), new $Int64(1564699815, 1482500298), new $Int64(1406657158, 840489337), new $Int64(799522364, 3483178565), new $Int64(532129761, 2074004656), new $Int64(724246478, 3643392642), new $Int64(1482330167, 1583624461), new $Int64(1261660694, 287473085), new $Int64(1667835381, 3136843981), new $Int64(1138806821, 1266970974), new $Int64(135185781, 1998688839), new $Int64(392094735, 1492900209), new $Int64(1031326774, 1538112737), new $Int64(76914806, 2207265429), new $Int64(260686035, 963263315), new $Int64(1671145500, 2295892134), new $Int64(1068469660, 2002560897), new $Int64(1791233343, 1369254035), new $Int64(33436120, 3353312708), new $Int64(57507843, 947771099), new $Int64(201728503, 1747061399), new $Int64(1507240140, 2047354631), new $Int64(720000810, 4165367136), new $Int64(479265078, 3388864963), new $Int64(1195302398, 286492130), new $Int64(2045622690, 2795735007), new $Int64(1431753082, 3703961339), new $Int64(1999047161, 1797825479), new $Int64(1429039600, 1116589674), new $Int64(482063550, 2593309206), new $Int64(1329049334, 3404995677), new $Int64(1396904208, 3453462936), new $Int64(1014767077, 3016498634), new $Int64(75698599, 1650371545), new $Int64(1592007860, 212344364), new $Int64(1127766888, 3843932156), new $Int64(1399463792, 3573129983), new $Int64(1256901817, 665897820), new $Int64(1071492673, 1675628772), new $Int64(243225682, 2831752928), new $Int64(2120298836, 1486294219), new $Int64(193076235, 268782709), new $Int64(1145360145, 4186179080), new $Int64(624342951, 1613720397), new $Int64(857179861, 2703686015), new $Int64(1235864944, 2205342611), new $Int64(1474779655, 1411666394), new $Int64(619028749, 677744900), new $Int64(270855115, 4172867247), new $Int64(135494707, 2163418403), new $Int64(849547544, 2841526879), new $Int64(1029966689, 1082141470), new $Int64(377371856, 4046134367), new $Int64(51415528, 2142943655), new $Int64(1897659315, 3124627521), new $Int64(998228909, 219992939), new $Int64(1068692697, 1756846531), new $Int64(1283749206, 1225118210), new $Int64(1621625642, 1647770243), new $Int64(111523943, 444807907), new $Int64(2036369448, 3952076173), new $Int64(53201823, 1461839639), new $Int64(315761893, 3699250910), new $Int64(702974850, 1373688981), new $Int64(734022261, 147523747), new $Int64(100152742, 1211276581), new $Int64(1294440951, 2548832680), new $Int64(1144696256, 1995631888), new $Int64(154500578, 2011457303), new $Int64(796460974, 3057425772), new $Int64(667839456, 81484597), new $Int64(465502760, 3646681560), new $Int64(775020923, 635548515), new $Int64(602489502, 2508044581), new $Int64(353263531, 1014917157), new $Int64(719992433, 3214891315), new $Int64(852684611, 959582252), new $Int64(226415134, 3347040449), new $Int64(1784615552, 4102971975), new $Int64(397887437, 4078022210), new $Int64(1610679822, 2851767182), new $Int64(749162636, 1540160644), new $Int64(598384772, 1057290595), new $Int64(2034890660, 3907769253), new $Int64(579300318, 4248952684), new $Int64(1092907599, 132554364), new $Int64(1061621234, 1029351092), new $Int64(697840928, 2583007416), new $Int64(298619124, 1486185789), new $Int64(55905697, 2871589073), new $Int64(2017643612, 723203291), new $Int64(146250550, 2494333952), new $Int64(1064490251, 2230939180), new $Int64(342915576, 3943232912), new $Int64(1768732449, 2181367922), new $Int64(1418222537, 2889274791), new $Int64(1824032949, 2046728161), new $Int64(1653899792, 1376052477), new $Int64(1022327048, 381236993), new $Int64(1034385958, 3188942166), new $Int64(2073003539, 350070824), new $Int64(144881592, 61758415), new $Int64(1405659422, 3492950336), new $Int64(117440928, 3093818430), new $Int64(1693893113, 2962480613), new $Int64(235432940, 3154871160), new $Int64(511005079, 3228564679), new $Int64(610731502, 888276216), new $Int64(1200780674, 3574998604), new $Int64(870415268, 1967526716), new $Int64(591335707, 1554691298), new $Int64(574459414, 339944798), new $Int64(1223764147, 1154515356), new $Int64(1825645307, 967516237), new $Int64(1546195135, 596588202), new $Int64(279882768, 3764362170), new $Int64(492091056, 266611402), new $Int64(1754227768, 2047856075), new $Int64(1146757215, 21444105), new $Int64(1198058894, 3065563181), new $Int64(1915064845, 1140663212), new $Int64(633187674, 2323741028), new $Int64(2126290159, 3103873707), new $Int64(1008658319, 2766828349), new $Int64(1661896145, 1970872996), new $Int64(1628585413, 3766615585), new $Int64(1552335120, 2036813414), new $Int64(152606527, 3105536507), new $Int64(13954645, 3396176938), new $Int64(1426081645, 1377154485), new $Int64(2085644467, 3807014186), new $Int64(543009040, 3710110597), new $Int64(396058129, 916420443), new $Int64(734556788, 2103831255), new $Int64(381322154, 717331943), new $Int64(572884752, 3550505941), new $Int64(45939673, 378749927), new $Int64(149867929, 611017331), new $Int64(592130075, 758907650), new $Int64(1012992349, 154266815), new $Int64(1107028706, 1407468696), new $Int64(469292398, 970098704), new $Int64(1862426162, 1971660656), new $Int64(998365243, 3332747885), new $Int64(1947089649, 1935189867), new $Int64(1510248801, 203520055), new $Int64(842317902, 3916463034), new $Int64(1758884993, 3474113316), new $Int64(1036101639, 316544223), new $Int64(373738757, 1650844677), new $Int64(1240292229, 4267565603), new $Int64(1077208624, 2501167616), new $Int64(626831785, 3929401789), new $Int64(56122796, 337170252), new $Int64(1186981558, 2061966842), new $Int64(1843292800, 2508461464), new $Int64(206012532, 2791377107), new $Int64(1240791848, 1227227588), new $Int64(1813978778, 1709681848), new $Int64(1153692192, 3768820575), new $Int64(1145186199, 2887126398), new $Int64(700372314, 296561685), new $Int64(700300844, 3729960077), new $Int64(575172304, 372833036), new $Int64(2078875613, 2409779288), new $Int64(1829161290, 555274064), new $Int64(1041887929, 4239804901), new $Int64(1839403216, 3723486978), new $Int64(498390553, 2145871984), new $Int64(564717933, 3565480803), new $Int64(578829821, 2197313814), new $Int64(974785092, 3613674566), new $Int64(438638731, 3042093666), new $Int64(2050927384, 3324034321), new $Int64(869420878, 3708873369), new $Int64(946682149, 1698090092), new $Int64(1618900382, 4213940712), new $Int64(304003901, 2087477361), new $Int64(381315848, 2407950639), new $Int64(851258090, 3942568569), new $Int64(923583198, 4088074412), new $Int64(723260036, 2964773675), new $Int64(1473561819, 1539178386), new $Int64(1062961552, 2694849566), new $Int64(460977733, 2120273838), new $Int64(542912908, 2484608657), new $Int64(880846449, 2956190677), new $Int64(1970902366, 4223313749), new $Int64(662161910, 3502682327), new $Int64(705634754, 4133891139), new $Int64(1116124348, 1166449596), new $Int64(1038247601, 3362705993), new $Int64(93734798, 3892921029), new $Int64(1876124043, 786869787), new $Int64(1057490746, 1046342263), new $Int64(242763728, 493777327), new $Int64(1293910447, 3304827646), new $Int64(616460742, 125356352), new $Int64(499300063, 74094113), new $Int64(1351896723, 2500816079), new $Int64(1657235204, 514015239), new $Int64(1377565129, 543520454), new $Int64(107706923, 3614531153), new $Int64(2056746300, 2356753985), new $Int64(1390062617, 2018141668), new $Int64(131272971, 2087974891), new $Int64(644556607, 3166972343), new $Int64(372256200, 1517638666), new $Int64(1212207984, 173466846), new $Int64(1451709187, 4241513471), new $Int64(733932806, 2783126920), new $Int64(1972004134, 4167264826), new $Int64(29260506, 3907395640), new $Int64(1236582087, 1539634186), new $Int64(1551526350, 178241987), new $Int64(2034206012, 182168164), new $Int64(1044953189, 2386154934), new $Int64(1379126408, 4077374341), new $Int64(32803926, 1732699140), new $Int64(1726425903, 1041306002), new $Int64(1860414813, 2068001749), new $Int64(1005320202, 3208962910), new $Int64(844054010, 697710380), new $Int64(638124245, 2228431183), new $Int64(1337169671, 3554678728), new $Int64(1396494601, 173470263), new $Int64(2061597383, 3848297795), new $Int64(1220546671, 246236185), new $Int64(163293187, 2066374846), new $Int64(1771673660, 312890749), new $Int64(703378057, 3573310289), new $Int64(1548631747, 143166754), new $Int64(613554316, 2081511079), new $Int64(1197802104, 486038032), new $Int64(240999859, 2982218564), new $Int64(364901986, 1000939191), new $Int64(1902782651, 2750454885), new $Int64(1475638791, 3375313137), new $Int64(503615608, 881302957), new $Int64(638698903, 2514186393), new $Int64(443860803, 360024739), new $Int64(1399671872, 292500025), new $Int64(1381210821, 2276300752), new $Int64(521803381, 4069087683), new $Int64(208500981, 1637778212), new $Int64(720490469, 1676670893), new $Int64(1067262482, 3855174429), new $Int64(2114075974, 2067248671), new $Int64(2058057389, 2884561259), new $Int64(1341742553, 2456511185), new $Int64(983726246, 561175414), new $Int64(427994085, 432588903), new $Int64(885133709, 4059399550), new $Int64(2054387382, 1075014784), new $Int64(413651020, 2728058415), new $Int64(1839142064, 1299703678), new $Int64(1262333188, 2347583393), new $Int64(1285481956, 2468164145), new $Int64(989129637, 1140014346), new $Int64(2033889184, 1936972070), new $Int64(409904655, 3870530098), new $Int64(1662989391, 1717789158), new $Int64(1914486492, 1153452491), new $Int64(1157059232, 3948827651), new $Int64(790338018, 2101413152), new $Int64(1495744672, 3854091229), new $Int64(83644069, 4215565463), new $Int64(762206335, 1202710438), new $Int64(1582574611, 2072216740), new $Int64(705690639, 2066751068), new $Int64(33900336, 173902580), new $Int64(1405499842, 142459001), new $Int64(172391592, 1889151926), new $Int64(1648540523, 3034199774), new $Int64(1618587731, 516490102), new $Int64(93114264, 3692577783), new $Int64(68662295, 2953948865), new $Int64(1826544975, 4041040923), new $Int64(204965672, 592046130), new $Int64(1441840008, 384297211), new $Int64(95834184, 265863924), new $Int64(2101717619, 1333136237), new $Int64(1499611781, 1406273556), new $Int64(1074670496, 426305476), new $Int64(125704633, 2750898176), new $Int64(488068495, 1633944332), new $Int64(2037723464, 3236349343), new $Int64(444060402, 4013676611), new $Int64(1718532237, 2265047407), new $Int64(1433593806, 875071080), new $Int64(1804436145, 1418843655), new $Int64(2009228711, 451657300), new $Int64(1229446621, 1866374663), new $Int64(1653472867, 1551455622), new $Int64(577191481, 3560962459), new $Int64(1669204077, 3347903778), new $Int64(1849156454, 2675874918), new $Int64(316128071, 2762991672), new $Int64(530492383, 3689068477), new $Int64(844089962, 4071997905), new $Int64(1508155730, 1381702441), new $Int64(2089931018, 2373284878), new $Int64(1283216186, 2143983064), new $Int64(308739063, 1938207195), new $Int64(1754949306, 1188152253), new $Int64(1272345009, 615870490), new $Int64(742653194, 2662252621), new $Int64(1477718295, 3839976789), new $Int64(56149435, 306752547), new $Int64(720795581, 2162363077), new $Int64(2090431015, 2767224719), new $Int64(675859549, 2628837712), new $Int64(1678405918, 2967771969), new $Int64(1694285728, 499792248), new $Int64(403352367, 4285253508), new $Int64(962357072, 2856511070), new $Int64(679471692, 2526409716), new $Int64(353777175, 1240875658), new $Int64(1232590226, 2577342868), new $Int64(1146185433, 4136853496), new $Int64(670368674, 2403540137), new $Int64(1372824515, 1371410668), new $Int64(1970921600, 371758825), new $Int64(1706420536, 1528834084), new $Int64(2075795018, 1504757260), new $Int64(685663576, 699052551), new $Int64(1641940109, 3347789870), new $Int64(1951619734, 3430604759), new $Int64(2119672219, 1935601723), new $Int64(966789690, 834676166)]);
		globalRand = New(new lockedSource.Ptr(new sync.Mutex.Ptr(), NewSource(new $Int64(0, 1))));
	};
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, errorString, New;
	errorString = $pkg.errorString = $newType(0, "Struct", "errors.errorString", "errorString", "errors", function(s_) {
		this.$val = this;
		this.s = s_ !== undefined ? s_ : "";
	});
	New = $pkg.New = function(text) {
		return new errorString.Ptr(text);
	};
	errorString.Ptr.prototype.Error = function() {
		var e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	$pkg.$init = function() {
		($ptrType(errorString)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1]];
		errorString.init([["s", "s", "errors", $String, ""]]);
	};
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, runtime = $packages["runtime"], errors = $packages["errors"], sync = $packages["sync"], errWhence, errOffset;
	$pkg.$init = function() {
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
	};
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {};
	$pkg.$init = function() {
	};
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, decodeRuneInStringInternal, DecodeRuneInString, RuneCountInString;
	decodeRuneInStringInternal = function(s) {
		var r = 0, size = 0, short$1 = false, n, _tmp, _tmp$1, _tmp$2, c0, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tmp$10, _tmp$11, c1, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$20, _tmp$21, _tmp$22, _tmp$23, c2, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, c3, _tmp$39, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$47, _tmp$48, _tmp$49, _tmp$50;
		n = s.length;
		if (n < 1) {
			_tmp = 65533; _tmp$1 = 0; _tmp$2 = true; r = _tmp; size = _tmp$1; short$1 = _tmp$2;
			return [r, size, short$1];
		}
		c0 = s.charCodeAt(0);
		if (c0 < 128) {
			_tmp$3 = (c0 >> 0); _tmp$4 = 1; _tmp$5 = false; r = _tmp$3; size = _tmp$4; short$1 = _tmp$5;
			return [r, size, short$1];
		}
		if (c0 < 192) {
			_tmp$6 = 65533; _tmp$7 = 1; _tmp$8 = false; r = _tmp$6; size = _tmp$7; short$1 = _tmp$8;
			return [r, size, short$1];
		}
		if (n < 2) {
			_tmp$9 = 65533; _tmp$10 = 1; _tmp$11 = true; r = _tmp$9; size = _tmp$10; short$1 = _tmp$11;
			return [r, size, short$1];
		}
		c1 = s.charCodeAt(1);
		if (c1 < 128 || 192 <= c1) {
			_tmp$12 = 65533; _tmp$13 = 1; _tmp$14 = false; r = _tmp$12; size = _tmp$13; short$1 = _tmp$14;
			return [r, size, short$1];
		}
		if (c0 < 224) {
			r = ((((c0 & 31) >>> 0) >> 0) << 6 >> 0) | (((c1 & 63) >>> 0) >> 0);
			if (r <= 127) {
				_tmp$15 = 65533; _tmp$16 = 1; _tmp$17 = false; r = _tmp$15; size = _tmp$16; short$1 = _tmp$17;
				return [r, size, short$1];
			}
			_tmp$18 = r; _tmp$19 = 2; _tmp$20 = false; r = _tmp$18; size = _tmp$19; short$1 = _tmp$20;
			return [r, size, short$1];
		}
		if (n < 3) {
			_tmp$21 = 65533; _tmp$22 = 1; _tmp$23 = true; r = _tmp$21; size = _tmp$22; short$1 = _tmp$23;
			return [r, size, short$1];
		}
		c2 = s.charCodeAt(2);
		if (c2 < 128 || 192 <= c2) {
			_tmp$24 = 65533; _tmp$25 = 1; _tmp$26 = false; r = _tmp$24; size = _tmp$25; short$1 = _tmp$26;
			return [r, size, short$1];
		}
		if (c0 < 240) {
			r = (((((c0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((c1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((c2 & 63) >>> 0) >> 0);
			if (r <= 2047) {
				_tmp$27 = 65533; _tmp$28 = 1; _tmp$29 = false; r = _tmp$27; size = _tmp$28; short$1 = _tmp$29;
				return [r, size, short$1];
			}
			if (55296 <= r && r <= 57343) {
				_tmp$30 = 65533; _tmp$31 = 1; _tmp$32 = false; r = _tmp$30; size = _tmp$31; short$1 = _tmp$32;
				return [r, size, short$1];
			}
			_tmp$33 = r; _tmp$34 = 3; _tmp$35 = false; r = _tmp$33; size = _tmp$34; short$1 = _tmp$35;
			return [r, size, short$1];
		}
		if (n < 4) {
			_tmp$36 = 65533; _tmp$37 = 1; _tmp$38 = true; r = _tmp$36; size = _tmp$37; short$1 = _tmp$38;
			return [r, size, short$1];
		}
		c3 = s.charCodeAt(3);
		if (c3 < 128 || 192 <= c3) {
			_tmp$39 = 65533; _tmp$40 = 1; _tmp$41 = false; r = _tmp$39; size = _tmp$40; short$1 = _tmp$41;
			return [r, size, short$1];
		}
		if (c0 < 248) {
			r = ((((((c0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((c1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((c2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((c3 & 63) >>> 0) >> 0);
			if (r <= 65535 || 1114111 < r) {
				_tmp$42 = 65533; _tmp$43 = 1; _tmp$44 = false; r = _tmp$42; size = _tmp$43; short$1 = _tmp$44;
				return [r, size, short$1];
			}
			_tmp$45 = r; _tmp$46 = 4; _tmp$47 = false; r = _tmp$45; size = _tmp$46; short$1 = _tmp$47;
			return [r, size, short$1];
		}
		_tmp$48 = 65533; _tmp$49 = 1; _tmp$50 = false; r = _tmp$48; size = _tmp$49; short$1 = _tmp$50;
		return [r, size, short$1];
	};
	DecodeRuneInString = $pkg.DecodeRuneInString = function(s) {
		var r = 0, size = 0, _tuple;
		_tuple = decodeRuneInStringInternal(s); r = _tuple[0]; size = _tuple[1];
		return [r, size];
	};
	RuneCountInString = $pkg.RuneCountInString = function(s) {
		var n = 0, _ref, _i, _rune;
		_ref = s;
		_i = 0;
		while (_i < _ref.length) {
			_rune = $decodeRune(_ref, _i);
			n = n + (1) >> 0;
			_i += _rune[1];
		}
		return n;
	};
	$pkg.$init = function() {
	};
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, js = $packages["github.com/gopherjs/gopherjs/js"], errors = $packages["errors"], io = $packages["io"], utf8 = $packages["unicode/utf8"], unicode = $packages["unicode"], explode, hashstr, Count, genSplit, Split;
	explode = function(s, n) {
		var l, a, size, ch, _tmp, _tmp$1, i, cur, _tuple;
		if (n === 0) {
			return ($sliceType($String)).nil;
		}
		l = utf8.RuneCountInString(s);
		if (n <= 0 || n > l) {
			n = l;
		}
		a = ($sliceType($String)).make(n);
		size = 0;
		ch = 0;
		_tmp = 0; _tmp$1 = 0; i = _tmp; cur = _tmp$1;
		while ((i + 1 >> 0) < n) {
			_tuple = utf8.DecodeRuneInString(s.substring(cur)); ch = _tuple[0]; size = _tuple[1];
			if (ch === 65533) {
				(i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = "\xEF\xBF\xBD";
			} else {
				(i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = s.substring(cur, (cur + size >> 0));
			}
			cur = cur + (size) >> 0;
			i = i + (1) >> 0;
		}
		if (cur < s.length) {
			(i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = s.substring(cur);
		}
		return a;
	};
	hashstr = function(sep) {
		var hash, i, _tmp, _tmp$1, pow, sq, i$1, x, x$1;
		hash = 0;
		i = 0;
		while (i < sep.length) {
			hash = ((((hash >>> 16 << 16) * 16777619 >>> 0) + (hash << 16 >>> 16) * 16777619) >>> 0) + (sep.charCodeAt(i) >>> 0) >>> 0;
			i = i + (1) >> 0;
		}
		_tmp = 1; _tmp$1 = 16777619; pow = _tmp; sq = _tmp$1;
		i$1 = sep.length;
		while (i$1 > 0) {
			if (!(((i$1 & 1) === 0))) {
				pow = (x = sq, (((pow >>> 16 << 16) * x >>> 0) + (pow << 16 >>> 16) * x) >>> 0);
			}
			sq = (x$1 = sq, (((sq >>> 16 << 16) * x$1 >>> 0) + (sq << 16 >>> 16) * x$1) >>> 0);
			i$1 = (i$1 >> $min((1), 31)) >> 0;
		}
		return [hash, pow];
	};
	Count = $pkg.Count = function(s, sep) {
		var n, c, i, _tuple, hashsep, pow, h, i$1, lastmatch, i$2, x, x$1;
		n = 0;
		if (sep.length === 0) {
			return utf8.RuneCountInString(s) + 1 >> 0;
		} else if (sep.length === 1) {
			c = sep.charCodeAt(0);
			i = 0;
			while (i < s.length) {
				if (s.charCodeAt(i) === c) {
					n = n + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			return n;
		} else if (sep.length > s.length) {
			return 0;
		} else if (sep.length === s.length) {
			if (sep === s) {
				return 1;
			}
			return 0;
		}
		_tuple = hashstr(sep); hashsep = _tuple[0]; pow = _tuple[1];
		h = 0;
		i$1 = 0;
		while (i$1 < sep.length) {
			h = ((((h >>> 16 << 16) * 16777619 >>> 0) + (h << 16 >>> 16) * 16777619) >>> 0) + (s.charCodeAt(i$1) >>> 0) >>> 0;
			i$1 = i$1 + (1) >> 0;
		}
		lastmatch = 0;
		if ((h === hashsep) && s.substring(0, sep.length) === sep) {
			n = n + (1) >> 0;
			lastmatch = sep.length;
		}
		i$2 = sep.length;
		while (i$2 < s.length) {
			h = (x = 16777619, (((h >>> 16 << 16) * x >>> 0) + (h << 16 >>> 16) * x) >>> 0);
			h = h + ((s.charCodeAt(i$2) >>> 0)) >>> 0;
			h = h - ((x$1 = (s.charCodeAt((i$2 - sep.length >> 0)) >>> 0), (((pow >>> 16 << 16) * x$1 >>> 0) + (pow << 16 >>> 16) * x$1) >>> 0)) >>> 0;
			i$2 = i$2 + (1) >> 0;
			if ((h === hashsep) && lastmatch <= (i$2 - sep.length >> 0) && s.substring((i$2 - sep.length >> 0), i$2) === sep) {
				n = n + (1) >> 0;
				lastmatch = i$2;
			}
		}
		return n;
	};
	genSplit = function(s, sep, sepSave, n) {
		var c, start, a, na, i;
		if (n === 0) {
			return ($sliceType($String)).nil;
		}
		if (sep === "") {
			return explode(s, n);
		}
		if (n < 0) {
			n = Count(s, sep) + 1 >> 0;
		}
		c = sep.charCodeAt(0);
		start = 0;
		a = ($sliceType($String)).make(n);
		na = 0;
		i = 0;
		while ((i + sep.length >> 0) <= s.length && (na + 1 >> 0) < n) {
			if ((s.charCodeAt(i) === c) && ((sep.length === 1) || s.substring(i, (i + sep.length >> 0)) === sep)) {
				(na < 0 || na >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + na] = s.substring(start, (i + sepSave >> 0));
				na = na + (1) >> 0;
				start = i + sep.length >> 0;
				i = i + ((sep.length - 1 >> 0)) >> 0;
			}
			i = i + (1) >> 0;
		}
		(na < 0 || na >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + na] = s.substring(start);
		return $subslice(a, 0, (na + 1 >> 0));
	};
	Split = $pkg.Split = function(s, sep) {
		return genSplit(s, sep, 0, -1);
	};
	$pkg.$init = function() {
	};
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, rand = $packages["math/rand"], strings = $packages["strings"], js = $packages["github.com/gopherjs/gopherjs/js"], Sprite, bigpile, smallpile, oven, headline, emptyPilePng, smallPilePng, pickPng1, pickPng2, fullPng1, fullPng2, emptyPng1, emptyPng2, shovelPng1, shovelPng2, white, context, showingBooks, s1state, s2state, gosched_chan, gosched_full, main, startGophers, fillbigpile, fire, gopher, pickBooks, pushBooks, fireBooks, moreBooks, loop, makeText, makeBitmap, makeSprite, Start, replaceBitmap, monitor, Gosched, RAF_callback, RAF;
	Sprite = $pkg.Sprite = $newType(0, "Struct", "main.Sprite", "Sprite", "main", function(bitmap_, x_, y_) {
		this.$val = this;
		this.bitmap = bitmap_ !== undefined ? bitmap_ : $ifaceNil;
		this.x = x_ !== undefined ? x_ : 0;
		this.y = y_ !== undefined ? y_ : 0;
	});
	main = function($b) {
		var $this = this, $args = arguments, $r, $s = 0;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		$r = Start(true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	startGophers = function($b) {
		var $this = this, $args = arguments, $r, $s = 0;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		bigpile = new ($chanType($Int, false, false))(1);
		$r = $send(bigpile, 1, true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		smallpile = new ($chanType($Int, false, false))(1);
		$r = $send(smallpile, 10, true); /* */ $s = 2; case 2: if ($r && $r.$blocking) { $r = $r(); }
		oven = new ($chanType($Int, false, false))(1);
		$go(fire, []);
		$go(gopher, [new ($ptrType($Float64))(function() { return $pkg.Sprite1X; }, function($v) { $pkg.Sprite1X = $v; }), new ($ptrType($Float64))(function() { return $pkg.Sprite1Y; }, function($v) { $pkg.Sprite1Y = $v; }), new ($ptrType($Int))(function() { return $pkg.Sprite1state; }, function($v) { $pkg.Sprite1state = $v; }), bigpile, smallpile]);
		$go(gopher, [new ($ptrType($Float64))(function() { return $pkg.Sprite2X; }, function($v) { $pkg.Sprite2X = $v; }), new ($ptrType($Float64))(function() { return $pkg.Sprite2Y; }, function($v) { $pkg.Sprite2Y = $v; }), new ($ptrType($Int))(function() { return $pkg.Sprite2state; }, function($v) { $pkg.Sprite2state = $v; }), smallpile, oven]);
		$go(fillbigpile, []);
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	fillbigpile = function($b) {
		var $this = this, $args = arguments, $r, $s = 0;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		/* while (true) { */ case 1: if(!(true)) { $s = 2; continue; }
			$r = $send(bigpile, rand.Intn(9) + 1 >> 0, true); /* */ $s = 3; case 3: if ($r && $r.$blocking) { $r = $r(); }
			$r = Gosched(true); /* */ $s = 4; case 4: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ $s = 1; continue; case 2:
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	fire = function($b) {
		var $this = this, $args = arguments, $r, $s = 0, _r;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		/* while (true) { */ case 1: if(!(true)) { $s = 2; continue; }
			_r = $recv(oven, true); /* */ $s = 3; case 3: if (_r && _r.$blocking) { _r = _r(); }
			_r[0];
			$r = Gosched(true); /* */ $s = 4; case 4: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ $s = 1; continue; case 2:
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	gopher = function(x, y, state, in$1, out, $b) {
		var $this = this, $args = arguments, $r, $s = 0, _r, cartLoad;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		/* while (true) { */ case 1: if(!(true)) { $s = 2; continue; }
			_r = pickBooks(x, y, state, in$1, true); /* */ $s = 3; case 3: if (_r && _r.$blocking) { _r = _r(); }
			cartLoad = _r;
			$r = pushBooks(x, y, state, cartLoad, true); /* */ $s = 4; case 4: if ($r && $r.$blocking) { $r = $r(); }
			$r = fireBooks(x, y, state, cartLoad, out, true); /* */ $s = 5; case 5: if ($r && $r.$blocking) { $r = $r(); }
			$r = moreBooks(x, y, state, true); /* */ $s = 6; case 6: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ $s = 1; continue; case 2:
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	pickBooks = function(x, y, state, in$1, $b) {
		var $this = this, $args = arguments, $r, $s = 0, _r, v;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		state.$set(0);
		x.$set(0);
		_r = $recv(in$1, true); /* */ $s = 1; case 1: if (_r && _r.$blocking) { _r = _r(); }
		v = _r[0];
		$r = loop(v, true); /* */ $s = 2; case 2: if ($r && $r.$blocking) { $r = $r(); }
		return v;
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	pushBooks = function(x, y, state, cartLoad, $b) {
		var $this = this, $args = arguments, $r, $s = 0;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		state.$set(1);
		x.$set(0);
		/* while (x.$get() < 150) { */ case 1: if(!(x.$get() < 150)) { $s = 2; continue; }
			if (y.$get() > 0) {
				y.$set(0);
			} else {
				y.$set(rand.Intn(3));
			}
			$r = Gosched(true); /* */ $s = 3; case 3: if ($r && $r.$blocking) { $r = $r(); }
			x.$set((x.$get()) + (10 / cartLoad));
		/* } */ $s = 1; continue; case 2:
		if (x.$get() > 150) {
			x.$set(150);
		}
		y.$set(0);
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	fireBooks = function(x, y, state, cartLoad, out, $b) {
		var $this = this, $args = arguments, $r, $s = 0;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		state.$set(2);
		$r = loop(cartLoad, true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		$r = $send(out, cartLoad, true); /* */ $s = 2; case 2: if ($r && $r.$blocking) { $r = $r(); }
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	moreBooks = function(x, y, state, $b) {
		var $this = this, $args = arguments, $r, $s = 0, _lhs;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		state.$set(3);
		/* while (x.$get() > 0) { */ case 1: if(!(x.$get() > 0)) { $s = 2; continue; }
			_lhs = x; _lhs.$set(_lhs.$get() - (10));
			if (x.$get() < 0) {
				x.$set(0);
			}
			if (y.$get() > 0) {
				y.$set(0);
			} else {
				y.$set(rand.Intn(5));
			}
			$r = Gosched(true); /* */ $s = 3; case 3: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ $s = 1; continue; case 2:
		y.$set(0);
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	loop = function(n, $b) {
		var $this = this, $args = arguments, $r, $s = 0, x;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		n = (x = 1, (((n >>> 16 << 16) * x >> 0) + (n << 16 >>> 16) * x) >> 0);
		/* while (n > 0) { */ case 1: if(!(n > 0)) { $s = 2; continue; }
			n = n - (1) >> 0;
			$r = Gosched(true); /* */ $s = 3; case 3: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ $s = 1; continue; case 2:
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	makeText = function(selectable, x, y, width, height, textColor, text) {
		var ss, _ref, _i, k, v;
		context.font = $externalize("12px Arial", $String);
		ss = strings.Split(text, "\n");
		_ref = ss;
		_i = 0;
		while (_i < _ref.$length) {
			k = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			context.fillText($externalize(v, $String), x, y + (((((12 >>> 16 << 16) * k >> 0) + (12 << 16 >>> 16) * k) >> 0)) >> 0);
			_i++;
		}
		return $ifaceNil;
	};
	makeBitmap = function(file) {
		var img;
		img = new ($global.Image)();
		img.src = $externalize(file, $String);
		return img;
	};
	makeSprite = function(bitmap, x, y) {
		var sp;
		sp = new Sprite.Ptr(bitmap, x, y);
		bitmap.addEventListener($externalize("load", $String), $externalize((function() {
			context.drawImage(bitmap, x, y);
			sp.bitmap = bitmap;
			sp.x = x;
			sp.y = y;
		}), ($funcType([], [], false))), $externalize(false, $Bool));
		return sp;
	};
	Start = $pkg.Start = function($b) {
		var $this = this, $args = arguments, $r, $s = 0, doc, canvas;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		doc = $global.document;
		canvas = doc.getElementById($externalize("myCanvas", $String));
		context = canvas.getContext($externalize("2d", $String));
		emptyPilePng = makeBitmap("assets/emptypile.png");
		smallPilePng = makeBitmap("assets/smallpile.png");
		pickPng1 = makeBitmap("assets/pick.png");
		pickPng2 = makeBitmap("assets/pick.png");
		fullPng1 = makeBitmap("assets/full.png");
		fullPng2 = makeBitmap("assets/full.png");
		emptyPng1 = makeBitmap("assets/empty.png");
		emptyPng2 = makeBitmap("assets/empty.png");
		shovelPng1 = makeBitmap("assets/shovel.png");
		shovelPng2 = makeBitmap("assets/shovel.png");
		white = makeBitmap("assets/white.png");
		$pkg.WT = makeBitmap("assets/whitethumb.png");
		headline = makeText(false, 200, 10, 500, 50, 32768, "");
		makeText(false, 10, 140, 180, 200, 32768, "Both animated gophers are \nrunning the code on the right.\nThe 2 logos show where they\neach are in that code now.\nGo translated to JS using\nGopherJS.");
		makeSprite(makeBitmap("assets/function.png"), 200, 110);
		makeText(true, 630, 140, 200, 200, 32768, "Inspired by Rob Pike:\n\"Concurrency is not Parallelism\"\nhttp://blog.golang.org/\nconcurrency-is-not-parallelism\n\n- Gopher by Renee French");
		makeSprite(makeBitmap("assets/bigpile.png"), 10, 20);
		makeSprite(makeBitmap("assets/oven.png"), 690, 0);
		$pkg.Books = makeSprite(emptyPilePng, 390, 50);
		$pkg.L1 = makeBitmap("assets/gophercolor16x16.png");
		$pkg.Logo1 = makeSprite($pkg.L1, 230, 140);
		$pkg.L2 = makeBitmap("assets/gophercolor16x16flipped.png");
		$pkg.Logo2 = makeSprite($pkg.L2, 540, 140);
		$pkg.Sprite1 = makeSprite(pickPng1, 90, 45);
		$pkg.Sprite2 = makeSprite(pickPng2, 420, 45);
		$r = RAF(true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		$r = startGophers(true); /* */ $s = 2; case 2: if ($r && $r.$blocking) { $r = $r(); }
		/* while (true) { */ case 3: if(!(true)) { $s = 4; continue; }
			$r = Gosched(true); /* */ $s = 5; case 5: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ $s = 3; continue; case 4:
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	replaceBitmap = function(sprite, bitmap, $b) {
		var $this = this, $args = arguments, $r, $s = 0;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		sprite.bitmap = bitmap.$get();
		context.drawImage(sprite.bitmap, sprite.x, sprite.y);
		$r = RAF(true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	monitor = function($b) {
		var $this = this, $args = arguments, $r, $s = 0, newY1, _ref, newS1X, newS1Y, _ref$1, newY2, _ref$2, newS2X, newS2Y, _ref$3;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		$r = RAF(true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		/* if (smallpile.$buffer.length > 0) { */ if (smallpile.$buffer.length > 0) {} else { $s = 2; continue; }
			/* if (!showingBooks) { */ if (!showingBooks) {} else { $s = 4; continue; }
				$r = replaceBitmap($pkg.Books, new ($ptrType(js.Object))(function() { return smallPilePng; }, function($v) { smallPilePng = $v; }), true); /* */ $s = 5; case 5: if ($r && $r.$blocking) { $r = $r(); }
				showingBooks = true;
			/* } */ case 4:
		/* } else { */ $s = 3; continue; case 2: 
			/* if (showingBooks) { */ if (showingBooks) {} else { $s = 6; continue; }
				$r = replaceBitmap($pkg.Books, new ($ptrType(js.Object))(function() { return emptyPilePng; }, function($v) { emptyPilePng = $v; }), true); /* */ $s = 7; case 7: if ($r && $r.$blocking) { $r = $r(); }
				showingBooks = false;
			/* } */ case 6:
		/* } */ case 3:
		newY1 = 140 + (((((15 >>> 16 << 16) * $pkg.Sprite1state >> 0) + (15 << 16 >>> 16) * $pkg.Sprite1state) >> 0)) >> 0;
		/* if (!(($pkg.Logo1.y === newY1))) { */ if (!(($pkg.Logo1.y === newY1))) {} else { $s = 8; continue; }
			$r = replaceBitmap($pkg.Logo1, new ($ptrType(js.Object))(function() { return $pkg.WT; }, function($v) { $pkg.WT = $v; }), true); /* */ $s = 9; case 9: if ($r && $r.$blocking) { $r = $r(); }
			$pkg.Logo1.y = newY1;
			$r = replaceBitmap($pkg.Logo1, new ($ptrType(js.Object))(function() { return $pkg.L1; }, function($v) { $pkg.L1 = $v; }), true); /* */ $s = 10; case 10: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ case 8:
		/* if (!((s1state === $pkg.Sprite1state))) { */ if (!((s1state === $pkg.Sprite1state))) {} else { $s = 11; continue; }
			_ref = s1state;
			/* if (_ref === 2 || _ref === 0) { */ if (_ref === 2 || _ref === 0) {} else { $s = 12; continue; }
				$r = replaceBitmap($pkg.Sprite1, new ($ptrType(js.Object))(function() { return white; }, function($v) { white = $v; }), true); /* */ $s = 13; case 13: if ($r && $r.$blocking) { $r = $r(); }
			/* } */ case 12:
			s1state = $pkg.Sprite1state;
		/* } */ case 11:
		newS1X = (90 + $pkg.Sprite1X >> 0);
		newS1Y = (45 + $pkg.Sprite1Y >> 0);
		/* if (!(($pkg.Sprite1.x === newS1X)) || !(($pkg.Sprite1.y === newS1Y))) { */ if (!(($pkg.Sprite1.x === newS1X)) || !(($pkg.Sprite1.y === newS1Y))) {} else { $s = 14; continue; }
			$pkg.Sprite1.x = newS1X;
			$pkg.Sprite1.y = newS1Y;
			_ref$1 = $pkg.Sprite1state;
			/* if (_ref$1 === 0) { */ if (_ref$1 === 0) {} else if (_ref$1 === 1) { $s = 15; continue; } else if (_ref$1 === 2) { $s = 16; continue; } else if (_ref$1 === 3) { $s = 17; continue; } else { $s = 18; continue; }
				$r = replaceBitmap($pkg.Sprite1, new ($ptrType(js.Object))(function() { return pickPng1; }, function($v) { pickPng1 = $v; }), true); /* */ $s = 19; case 19: if ($r && $r.$blocking) { $r = $r(); }
			/* } else if (_ref$1 === 1) { */ $s = 18; continue; case 15: 
				$r = replaceBitmap($pkg.Sprite1, new ($ptrType(js.Object))(function() { return fullPng1; }, function($v) { fullPng1 = $v; }), true); /* */ $s = 20; case 20: if ($r && $r.$blocking) { $r = $r(); }
			/* } else if (_ref$1 === 2) { */ $s = 18; continue; case 16: 
				$r = replaceBitmap($pkg.Sprite1, new ($ptrType(js.Object))(function() { return shovelPng1; }, function($v) { shovelPng1 = $v; }), true); /* */ $s = 21; case 21: if ($r && $r.$blocking) { $r = $r(); }
			/* } else if (_ref$1 === 3) { */ $s = 18; continue; case 17: 
				$r = replaceBitmap($pkg.Sprite1, new ($ptrType(js.Object))(function() { return emptyPng1; }, function($v) { emptyPng1 = $v; }), true); /* */ $s = 22; case 22: if ($r && $r.$blocking) { $r = $r(); }
			/* } */ case 18:
		/* } */ case 14:
		newY2 = 140 + (((((15 >>> 16 << 16) * $pkg.Sprite2state >> 0) + (15 << 16 >>> 16) * $pkg.Sprite2state) >> 0)) >> 0;
		/* if (!(($pkg.Logo2.y === newY2))) { */ if (!(($pkg.Logo2.y === newY2))) {} else { $s = 23; continue; }
			$r = replaceBitmap($pkg.Logo2, new ($ptrType(js.Object))(function() { return $pkg.WT; }, function($v) { $pkg.WT = $v; }), true); /* */ $s = 24; case 24: if ($r && $r.$blocking) { $r = $r(); }
			$pkg.Logo2.y = newY2;
			$r = replaceBitmap($pkg.Logo2, new ($ptrType(js.Object))(function() { return $pkg.L2; }, function($v) { $pkg.L2 = $v; }), true); /* */ $s = 25; case 25: if ($r && $r.$blocking) { $r = $r(); }
		/* } */ case 23:
		/* if (!((s2state === $pkg.Sprite2state))) { */ if (!((s2state === $pkg.Sprite2state))) {} else { $s = 26; continue; }
			_ref$2 = s2state;
			/* if (_ref$2 === 2 || _ref$2 === 0) { */ if (_ref$2 === 2 || _ref$2 === 0) {} else { $s = 27; continue; }
				$r = replaceBitmap($pkg.Sprite2, new ($ptrType(js.Object))(function() { return white; }, function($v) { white = $v; }), true); /* */ $s = 28; case 28: if ($r && $r.$blocking) { $r = $r(); }
			/* } */ case 27:
			s2state = $pkg.Sprite2state;
		/* } */ case 26:
		newS2X = (420 + $pkg.Sprite2X >> 0);
		newS2Y = (45 + $pkg.Sprite2Y >> 0);
		/* if (!(($pkg.Sprite2.x === newS2X)) || !(($pkg.Sprite2.y === newS2Y))) { */ if (!(($pkg.Sprite2.x === newS2X)) || !(($pkg.Sprite2.y === newS2Y))) {} else { $s = 29; continue; }
			$pkg.Sprite2.x = newS2X;
			$pkg.Sprite2.y = newS2Y;
			_ref$3 = $pkg.Sprite2state;
			/* if (_ref$3 === 0) { */ if (_ref$3 === 0) {} else if (_ref$3 === 1) { $s = 30; continue; } else if (_ref$3 === 2) { $s = 31; continue; } else if (_ref$3 === 3) { $s = 32; continue; } else { $s = 33; continue; }
				$r = replaceBitmap($pkg.Sprite2, new ($ptrType(js.Object))(function() { return pickPng2; }, function($v) { pickPng2 = $v; }), true); /* */ $s = 34; case 34: if ($r && $r.$blocking) { $r = $r(); }
			/* } else if (_ref$3 === 1) { */ $s = 33; continue; case 30: 
				$r = replaceBitmap($pkg.Sprite2, new ($ptrType(js.Object))(function() { return fullPng2; }, function($v) { fullPng2 = $v; }), true); /* */ $s = 35; case 35: if ($r && $r.$blocking) { $r = $r(); }
			/* } else if (_ref$3 === 2) { */ $s = 33; continue; case 31: 
				$r = replaceBitmap($pkg.Sprite2, new ($ptrType(js.Object))(function() { return shovelPng2; }, function($v) { shovelPng2 = $v; }), true); /* */ $s = 36; case 36: if ($r && $r.$blocking) { $r = $r(); }
			/* } else if (_ref$3 === 3) { */ $s = 33; continue; case 32: 
				$r = replaceBitmap($pkg.Sprite2, new ($ptrType(js.Object))(function() { return emptyPng2; }, function($v) { emptyPng2 = $v; }), true); /* */ $s = 37; case 37: if ($r && $r.$blocking) { $r = $r(); }
			/* } */ case 33:
		/* } */ case 29:
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	Gosched = $pkg.Gosched = function($b) {
		var $this = this, $args = arguments, $r, $s = 0, _r;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		$r = monitor(true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		/* if (gosched_full) { */ if (gosched_full) {} else { $s = 2; continue; }
			gosched_full = false;
			$r = $send(gosched_chan, true, true); /* */ $s = 4; case 4: if ($r && $r.$blocking) { $r = $r(); }
		/* } else { */ $s = 3; continue; case 2: 
			gosched_full = true;
			_r = $recv(gosched_chan, true); /* */ $s = 5; case 5: if (_r && _r.$blocking) { _r = _r(); }
			_r[0];
		/* } */ case 3:
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	RAF_callback = $pkg.RAF_callback = function() {
		$go((function($b) {
			var $this = this, $args = arguments, $r, $s = 0;
			/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
			$r = $send($pkg.RAF_chan, true, true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
			/* */ case -1: } return; } }; $f.$blocking = true; return $f;
		}), []);
	};
	RAF = $pkg.RAF = function($b) {
		var $this = this, $args = arguments, $r, $s = 0, _r;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		$global.window.requestAnimationFrame($externalize(RAF_callback, ($funcType([], [], false))));
		_r = $recv($pkg.RAF_chan, true); /* */ $s = 1; case 1: if (_r && _r.$blocking) { _r = _r(); }
		_r[0];
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	$pkg.$run = function($b) {
		var $this = this, $args = arguments, $r, $s = 0;
		/* */ if(!$b) { $nonblockingCall(); }; var $f = function() { while (true) { switch ($s) { case 0:
		$packages["github.com/gopherjs/gopherjs/js"].$init();
		$packages["runtime"].$init();
		$packages["math"].$init();
		$packages["sync/atomic"].$init();
		$packages["sync"].$init();
		$packages["math/rand"].$init();
		$packages["errors"].$init();
		$packages["io"].$init();
		$packages["unicode"].$init();
		$packages["unicode/utf8"].$init();
		$packages["strings"].$init();
		$pkg.$init();
		$r = main(true); /* */ $s = 1; case 1: if ($r && $r.$blocking) { $r = $r(); }
		/* */ case -1: } return; } }; $f.$blocking = true; return $f;
	};
	$pkg.$init = function() {
		Sprite.init([["bitmap", "bitmap", "main", js.Object, ""], ["x", "x", "main", $Int, ""], ["y", "y", "main", $Int, ""]]);
		bigpile = ($chanType($Int, false, false)).nil;
		smallpile = ($chanType($Int, false, false)).nil;
		oven = ($chanType($Int, false, false)).nil;
		$pkg.Sprite1X = 0;
		$pkg.Sprite1Y = 0;
		$pkg.Sprite2X = 0;
		$pkg.Sprite2Y = 0;
		$pkg.Sprite1state = 0;
		$pkg.Sprite2state = 0;
		headline = $ifaceNil;
		$pkg.Books = ($ptrType(Sprite)).nil;
		$pkg.Logo1 = ($ptrType(Sprite)).nil;
		$pkg.Logo2 = ($ptrType(Sprite)).nil;
		$pkg.Sprite1 = ($ptrType(Sprite)).nil;
		$pkg.Sprite2 = ($ptrType(Sprite)).nil;
		emptyPilePng = $ifaceNil;
		smallPilePng = $ifaceNil;
		pickPng1 = $ifaceNil;
		pickPng2 = $ifaceNil;
		fullPng1 = $ifaceNil;
		fullPng2 = $ifaceNil;
		emptyPng1 = $ifaceNil;
		emptyPng2 = $ifaceNil;
		shovelPng1 = $ifaceNil;
		shovelPng2 = $ifaceNil;
		white = $ifaceNil;
		$pkg.L1 = $ifaceNil;
		$pkg.L2 = $ifaceNil;
		$pkg.WT = $ifaceNil;
		context = $ifaceNil;
		gosched_full = false;
		showingBooks = true;
		s1state = 0;
		s2state = 0;
		gosched_chan = new ($chanType($Bool, false, false))(1);
		$pkg.RAF_chan = new ($chanType($Bool, false, false))(1);
	};
	return $pkg;
})();
$go($packages["main"].$run, [], true);

})();
//# sourceMappingURL=gophers.js.map
