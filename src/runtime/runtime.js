// Copyright 2012 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


/**
 * The traceur runtime.
 */
var traceur = traceur || {};
traceur.runtime = (function() {
  'use strict';
  var $create = Object.create;
  var $defineProperty = Object.defineProperty;
  var $freeze = Object.freeze;
  var $getOwnPropertyNames = Object.getOwnPropertyNames;
  var $getPrototypeOf = Object.getPrototypeOf;
  var $call = Function.prototype.call.bind(Function.prototype.call);
  var $hasOwnProperty = Object.prototype.hasOwnProperty;
  var bind = Function.prototype.bind;

  function nonEnum(value) {
    return {
      configurable: true,
      enumerable: false,
      value: value,
      writable: true
    };
  }

  var method = nonEnum;

  // Harmony String Extras
  // http://wiki.ecmascript.org/doku.php?id=harmony:string_extras
  Object.defineProperties(String.prototype, {
    startsWith: method(function(s) {
     return this.lastIndexOf(s, 0) === 0;
    }),
    endsWith: method(function(s) {
      var t = String(s);
      var l = this.length - t.length;
      return l >= 0 && this.indexOf(t, l) === l;
    }),
    contains: method(function(s) {
      return this.indexOf(s) !== -1;
    }),
    toArray: method(function() {
      return this.split('');
    })
  });

  function createClass(ctor, proto, extendsExpr) {
    if (extendsExpr !== null && Object(extendsExpr) !== extendsExpr)
      throw new TypeError('Can only extend objects or null');

    $defineProperty(proto, 'constructor', {value: ctor});

    var superPrototype;
    if (extendsExpr === null || !('prototype' in extendsExpr)) {
      superPrototype = extendsExpr;
    } else {
      ctor.__proto__ = extendsExpr;
      superPrototype = extendsExpr.prototype;
    }

    ctor.prototype = traceur.createObject(superPrototype, proto);
    return ctor;
  }

  function superCall(self, ctor, name, args) {
    var proto = $getPrototypeOf(ctor.prototype);
    var descriptor = $getPropertyDescriptor(proto, name);
    if (descriptor) {
      if (descriptor.value)
        return descriptor.value.apply(self, args);
      if (descriptor.get)
        return descriptor.get.call(self).apply(self, args);
    }
    throw new TypeError("Object has no method '" + name + "'.");
  }

  function superGet(self, ctor, name) {
    var proto = $getPrototypeOf(ctor.prototype);
    var descriptor = $getPropertyDescriptor(proto, name);
    if (descriptor) {
      if (descriptor.get)
        return descriptor.get.call(self);
      else if ('value' in descriptor)
        return descriptor.value;
    }
    return undefined;
  }

  function superSet(self, ctor, name, value) {
    var proto = $getPrototypeOf(ctor.prototype);
    var descriptor = $getPropertyDescriptor(proto, name);
    if (descriptor && descriptor.set) {
      descriptor.set.call(self, value);
      return;
    }
    throw new TypeError("Object has no setter '" + name + "'.");
  }

  var pushItem = Array.prototype.push.call.bind(Array.prototype.push);
  var pushArray = Array.prototype.push.apply.bind(Array.prototype.push);
  var slice = Array.prototype.slice.call.bind(Array.prototype.slice);
  var filter = Array.prototype.filter.call.bind(Array.prototype.filter);

  /**
   * Spreads the elements in {@code items} into a single array.
   * @param {Array} items Array of interleaving booleans and values.
   * @return {Array}
   */
  function spread(items) {
    var retval = [];
    for (var i = 0; i < items.length; i += 2) {
      if (items[i]) {
        if (items[i + 1] == null)
          continue;
        if (typeof items[i + 1] != 'object')
          throw TypeError('Spread expression has wrong type');
        pushArray(retval, slice(items[i + 1]));
      } else {
        pushItem(retval, items[i + 1]);
      }
    }
    return retval;
  }

  /**
   * @param {Function} ctor
   * @param {Array} items Array of interleaving booleans and values.
   * @return {Object}
   */
  function spreadNew(ctor, items) {
    var args = spread(items);
    args.unshift(null);
    var retval = new (bind.apply(ctor, args));
    return retval && typeof retval == 'object' ? retval : object;
  };

  /**
   * Marks properties as non enumerable.
   * @param {Object} object
   * @param {Array.<string>} names
   * @return {Object}
   */
  function markMethods(object, names) {
    names.forEach(function(name) {
      $defineProperty(object, name, {enumerable: false});
    });
    return object;
  }

  var counter = 0;

  /**
   * Generates a new unique string.
   * @return {string}
   */
  function newUniqueString() {
    return '__$' + Math.floor(Math.random() * 1e9) + '$' + ++counter + '$__';
  }

  var nameRe = /^__\$(?:\d+)\$(?:\d+)\$__$/;

  var internalStringValueName = newUniqueString();

  /**
   * Creates a new private name object.
   * @param {string=} string Optional string used for toString.
   * @constructor
   */
  function Name(string) {
    if (!string)
      string = newUniqueString();
    $defineProperty(this, internalStringValueName, {value: newUniqueString()});

    function toString() {
      return string;
    }
    $freeze(toString);
    $freeze(toString.prototype);
    var toStringDescr = method(toString);
    $defineProperty(this, 'toString', toStringDescr);

    this.public = $freeze($create(null, {
      toString: method($freeze(function toString() {
        return string;
      }))
    }));
    $freeze(this.public.toString.prototype);

    $freeze(this);
  };
  $freeze(Name);
  $freeze(Name.prototype);

  // Private name.

  // Collection getters and setters
  var elementDeleteName = new Name();
  var elementGetName = new Name();
  var elementSetName = new Name();

  // HACK: We should use runtime/modules/std/name.js or something like that.
  var NameModule = $freeze({
    Name: function(str) {
      return new Name(str);
    },
    isName: function(x) {
      return x instanceof Name;
    },
    elementGet: elementGetName,
    elementSet: elementSetName,
    elementDelete: elementDeleteName
  });

  // Override getOwnPropertyNames to filter out private name keys.
  function getOwnPropertyNames(object) {
    return filter($getOwnPropertyNames(object), function(str) {
      return !nameRe.test(str);
    });
  }

  // Override Object.prototpe.hasOwnProperty to always return false for
  // private names.
  function hasOwnProperty(name) {
    if (NameModule.isName(name) || nameRe.test(name))
      return false;
    return $hasOwnProperty.call(this, name);
  }

  function elementDelete(object, name) {
    if (hasPrivateNameProperty(object, elementDeleteName))
      return getProperty(object, elementDeleteName).call(object, name);
    return deleteProperty(object, name);
  }

  function elementGet(object, name) {
    if (hasPrivateNameProperty(object, elementGetName))
      return getProperty(object, elementGetName).call(object, name);
    return getProperty(object, name);
  }

  function elementHas(object, name) {
    // Should we allow trapping this too?
    return has(object, name);
  }

  function elementSet(object, name, value) {
    if (hasPrivateNameProperty(object, elementSetName))
      getProperty(object, elementSetName).call(object, name, value);
    else
      setProperty(object, name, value);
    return value;
  }

  function assertNotName(s) {
    if (nameRe.test(s))
      throw Error('Invalid access to private name');
  }

  function deleteProperty(object, name) {
    if (NameModule.isName(name))
      return delete object[name[internalStringValueName]];
    if (nameRe.test(name))
      return true;
    return delete object[name];
  }

  function getProperty(object, name) {
    if (NameModule.isName(name))
      return object[name[internalStringValueName]];
    if (nameRe.test(name))
      return undefined;
    return object[name];
  }

  function hasPrivateNameProperty(object, name) {
    return name[internalStringValueName] in Object(object);
  }

  function has(object, name) {
    if (NameModule.isName(name) || nameRe.test(name))
      return false;
    return name in Object(object);
  }

  // This is a bit simplistic.
  // http://wiki.ecmascript.org/doku.php?id=strawman:refactoring_put#object._get_set_property_built-ins
  function setProperty(object, name, value) {
    if (NameModule.isName(name)) {
      var descriptor = $getPropertyDescriptor(object,
                                              [name[internalStringValueName]]);
      if (descriptor)
        object[name[internalStringValueName]] = value;
      else
        $defineProperty(object, name[internalStringValueName], nonEnum(value));
    } else {
      assertNotName(name);
      object[name] = value;
    }
  }

  function defineProperty(object, name, descriptor) {
    if (NameModule.isName(name)) {
      // Private names should never be enumerable.
      if (descriptor.enumerable) {
        descriptor = Object.create(descriptor, {
          enumerable: {value: false}
        });
      }
      $defineProperty(object, name[internalStringValueName], descriptor);
    } else {
      assertNotName(name);
      $defineProperty(object, name, descriptor);
    }
  }

  function $getPropertyDescriptor(obj, name) {
    while (obj !== null) {
      var result = Object.getOwnPropertyDescriptor(obj, name);
      if (result)
        return result;
      obj = $getPrototypeOf(obj);
    }
    return undefined;
  }

  function getPropertyDescriptor(obj, name) {
    if (NameModule.isName(name))
      return undefined;
    assertNotName(name);
    return $getPropertyDescriptor(obj, name);
  }

  $defineProperty(Object, 'defineProperty', {value: defineProperty});
  $defineProperty(Object, 'deleteProperty', method(deleteProperty));
  $defineProperty(Object, 'getOwnPropertyNames', {value: getOwnPropertyNames});
  $defineProperty(Object, 'getProperty', method(getProperty));
  $defineProperty(Object, 'getPropertyDescriptor',
                  method(getPropertyDescriptor));
  $defineProperty(Object, 'has', method(has));
  $defineProperty(Object, 'setProperty', method(setProperty));
  $defineProperty(Object.prototype, 'hasOwnProperty', {value: hasOwnProperty});

  // is and isnt

  // Unlike === this returns true for (NaN, NaN) and false for (0, -0).
  function is(left, right) {
    if (left === right)
      return left !== 0 || 1 / left === 1 / right;
    return left !== left && right !== right;
  }

  function isnt(left, right) {
    return !is(left, right);
  }

  $defineProperty(Object, 'is', method(is));

  // Iterators.
  var iteratorName = new Name('iterator');

  /**
   * This is used to tag the return value from a generator.
   * @type Name
   */
  var generatorName = new Name('generator');

  var IterModule = {
    get iterator() {
      return iteratorName;
    }
    // TODO: Implement the rest of @iter and move it to a different file that
    // gets compiled.
  };

  function getIterator(collection) {
    // TODO: Keep an eye on the future spec to see whether this should
    // do "duck typing"?
    if (getProperty(collection, generatorName))
      return collection;
    return getProperty(collection, iteratorName).call(collection);
  }

  function markAsGenerator(object) {
    setProperty(object, generatorName, true);
  }

  // Make arrays iterable.
  defineProperty(Array.prototype, IterModule.iterator, method(function() {
    var index = 0;
    var array = this;
    var current;
    return {
      get current() {
        return current;
      },
      moveNext: function() {
        if (index < array.length) {
          current = array[index++];
          return true;
        }
        return false;
      }
    };
  }));

  /**
   * @param {Function} canceller
   * @constructor
   */
  function Deferred(canceller) {
    this.canceller_ = canceller;
    this.listeners_ = [];
  }

  function notify(self) {
    while (self.listeners_.length > 0) {
      var current = self.listeners_.shift();
      var currentResult = undefined;
      try {
        try {
          if (self.result_[1]) {
            if (current.errback)
              currentResult = current.errback.call(undefined, self.result_[0]);
          } else {
            if (current.callback)
              currentResult = current.callback.call(undefined, self.result_[0]);
          }
          current.deferred.callback(currentResult);
        } catch (err) {
          current.deferred.errback(err);
        }
      } catch (unused) {}
    }
  }

  function fire(self, value, isError) {
    if (self.fired_)
      throw new Error('already fired');

    self.fired_ = true;
    self.result_ = [value, isError];
    notify(self);
  }

  Deferred.prototype = {
    fired_: false,
    result_: undefined,

    createPromise: function() {
      return {then: this.then.bind(this), cancel: this.cancel.bind(this)};
    },

    callback: function(value) {
      fire(this, value, false);
    },

    errback: function(err) {
      fire(this, err, true);
    },

    then: function(callback, errback) {
      var result = new Deferred(this.cancel.bind(this));
      this.listeners_.push({
        deferred: result,
        callback: callback,
        errback: errback
      });
      if (this.fired_)
        notify(this);
      return result.createPromise();
    },

    cancel: function() {
      if (this.fired_)
        throw new Error('already finished');
      var result;
      if (this.canceller_) {
        result = this.canceller_(this);
        if (!result instanceof Error)
          result = new Error(result);
      } else {
        result = new Error('cancelled');
      }
      if (!this.fired_) {
        this.result_ = [result, true];
        notify(this);
      }
    }
  };

  var modules = $freeze({
    get '@name'() {
      return NameModule;
    },
    get '@iter'() {
      return IterModule;
    }
  });

  // Return the traceur namespace.
  return {
    createClass: createClass,
    Deferred: Deferred,
    elementDelete: elementDelete,
    elementGet: elementGet,
    elementHas: elementHas,
    elementSet: elementSet,
    getIterator: getIterator,
    is: is,
    isnt: isnt,
    markAsGenerator: markAsGenerator,
    markMethods: markMethods,
    modules: modules,
    spread: spread,
    spreadNew: spreadNew,
    superCall: superCall,
    superGet: superGet,
    superSet: superSet
  };
})();

var Deferred = traceur.runtime.Deferred;

