import { deprecate, format } from 'util';
import { logger } from '../logSettings';
import { buildSchema, mongoose } from '../typegoose';
import {
  AnyParamConstructor,
  DecoratedPropertyMetadata,
  DiscriminatorObject,
  KeyStringAny,
  NestedDiscriminatorsMap,
  VirtualPopulateMap
} from '../types';
import { DecoratorKeys, WhatIsIt } from './constants';
import { schemas } from './data';
import { InvalidPropError, InvalidTypeError, NotAllVPOPElementsError, NotNumberTypeError, NotStringTypeError } from './errors';
import * as utils from './utils';

/**
 * Function that is the actual processing of the prop's (used for caching)
 * @param input All the options needed for prop's
 */
export function processProp(input: DecoratedPropertyMetadata): void {
  const { key, target } = input;
  const name = utils.getName(target);
  const rawOptions: KeyStringAny = Object.assign({}, input.options);
  let Type: any | undefined = Reflect.getMetadata(DecoratorKeys.Type, target, key);
  const propKind = input.whatis ?? detectWhatIsIt(Type);

  logger.debug('Starting to process "%s.%s"', utils.getName(target), key);
  utils.assertion(typeof key === 'string', new Error(format('Property Key in typegoose cannot be an symbol! (%s.%s)', name, key)));

  optionDeprecation(rawOptions);

  {
    // soft errors & "type"-alias mapping
    switch (propKind) {
      case WhatIsIt.NONE:
        if ('items' in rawOptions) {
          logger.warn('You might not want to use option "items" for an non-array @prop type (%s.%s)', utils.getName(target), key);
        }

        if ('of' in rawOptions) {
          logger.warn('You might not want to use option "of" for an non-map @prop type (%s.%s)', utils.getName(target), key);
        }
        break;
      case WhatIsIt.ARRAY:
        if ('items' in rawOptions) {
          rawOptions.type = rawOptions.items;
          delete rawOptions.items;
        }

        if ('of' in rawOptions) {
          logger.warn('You might not want to use option "of" where the "design:type" is "Array" (%s.%s)', utils.getName(target), key);
        }

        // set the "Type" to undefined, if "ref" or "refPath" are defined, otherwise the "refType" will be wrong
        if ((('ref' in rawOptions) || ('refPath' in rawOptions)) && !('type' in rawOptions)) {
          Type = undefined;
        }
        break;
      case WhatIsIt.MAP:
        if ('of' in rawOptions) {
          rawOptions.type = rawOptions.of;
          delete rawOptions.of;
        }

        if ('items' in rawOptions) {
          logger.warn('You might not want to use option "items" where the "design:type" is "Map" (%s.%s)', name, key);
        }
        break;
    }
  }

  if (!utils.isNullOrUndefined(rawOptions.type)) {
    logger.info('Prop Option "type" is set to', rawOptions.type);
    Type = utils.getType(rawOptions.type);
    delete rawOptions.type;
  }

  // prevent "infinite" buildSchema loop / Maximum Stack size exceeded
  if (Type === target.constructor) {
    throw new TypeError(
      'It seems like the type used is the same as the target class, which is not supported\n' +
      `Please look at https://github.com/typegoose/typegoose/issues/42 for more information`
    );
  }

  // map to correct buffer type, otherwise it would result in "Mixed"
  if (Type === mongoose.Types.Buffer) {
    Type = mongoose.Schema.Types.Buffer;
  }

  if (utils.isNotDefined(Type)) {
    buildSchema(Type);
  }

  if ('discriminators' in rawOptions) {
    logger.debug('Found option "discriminators" in "%s.%s"', name, key);
    const discriminators: DiscriminatorObject[] =
      (utils.getType(rawOptions.discriminators) as (AnyParamConstructor<any> | DiscriminatorObject)[])
        .map((val, index) => {
          if (utils.isConstructor(val)) {
            return { type: val };
          }
          if (typeof val === 'object') {
            if (!('type' in val)) {
              throw new Error(
                format('"%s.%s" discriminator index "%s" is an object, but does not contain the "type" property!', name, key, index)
              );
            }

            return val;
          }

          throw new Error(format('"%s.%s" discriminators index "%s" is not an object or an constructor!', name, key, index));
        });

    const disMap: NestedDiscriminatorsMap = new Map(Reflect.getMetadata(DecoratorKeys.NestedDiscriminators, target.constructor) ?? []);
    disMap.set(key, discriminators);
    Reflect.defineMetadata(DecoratorKeys.NestedDiscriminators, disMap, target.constructor);

    delete rawOptions.discriminators;
  }

  // allow setting the type asynchronously
  if (!utils.isNullOrUndefined(rawOptions.ref)) {
    rawOptions.ref = utils.getType(rawOptions.ref);
    utils.assertion(
      !utils.isNullOrUndefined(rawOptions.ref),
      new Error(format('Option "ref" for "%s.%s" was defined with an arrow-function, but the function returned null/undefined!', name, key))
    );

    rawOptions.ref = typeof rawOptions.ref === 'string' ? rawOptions.ref : utils.getName(rawOptions.ref);
  }

  if (utils.isWithVirtualPOP(rawOptions)) {
    if (!utils.includesAllVirtualPOP(rawOptions)) {
      throw new NotAllVPOPElementsError(name, key);
    }

    const virtuals: VirtualPopulateMap = new Map(Reflect.getMetadata(DecoratorKeys.VirtualPopulate, target.constructor) ?? []);
    virtuals.set(key, rawOptions);
    Reflect.defineMetadata(DecoratorKeys.VirtualPopulate, virtuals, target.constructor);

    return;
  }

  const schemaProp = utils.initProperty(name, key, propKind);

  if (!utils.isNullOrUndefined(rawOptions.set) || !utils.isNullOrUndefined(rawOptions.get)) {
    utils.assertion(typeof rawOptions.set === 'function', new TypeError(`"${name}.${key}" does not have a set function!`));
    utils.assertion(typeof rawOptions.get === 'function', new TypeError(`"${name}.${key}" does not have a get function!`));

    /*
     * Note:
     * this doesn't have a check if prop & returntype of the function is the same,
     * because it can't be accessed at runtime
     */
    schemaProp[key] = {
      ...schemaProp[key],
      type: Type,
      ...rawOptions
    };

    return;
  }

  // use "Type" if it is an suitable ref-type, otherwise default back to "ObjectId"
  const refType = utils.isAnRefType(Type) ? Type : mongoose.Schema.Types.ObjectId;
  if ('ref' in rawOptions) {
    utils.assertion(
      !utils.isNullOrUndefined(rawOptions.ref),
      new Error(format('Options "ref" is set, but is undefined/null! (%s.%s)', name, key))
    );
    const ref = rawOptions.ref;
    delete rawOptions.ref;

    switch (propKind) {
      case WhatIsIt.ARRAY:
        schemaProp[key] = utils.createArrayFromDimensions(
          rawOptions,
          {
            ...schemaProp[key][0],
            type: refType,
            ref,
            ...rawOptions
          },
          name,
          key
        );
        break;
      case WhatIsIt.NONE:
        schemaProp[key] = {
          ...schemaProp[key],
          type: refType,
          ref,
          ...rawOptions
        };
        break;
      default:
        throw new TypeError(format('"ref" is not supported for "%s"! (%s, %s)', propKind, utils.getName(target), key));
    }

    return;
  }

  const refPath = rawOptions.refPath;
  if (refPath) {
    utils.assertion(
      typeof refPath === 'string',
      new TypeError(format('"refPath" for "%s, %s" should be of type String!', utils.getName(target), key))
    );

    delete rawOptions.refPath;

    switch (propKind) {
      case WhatIsIt.ARRAY:
        schemaProp[key] = utils.createArrayFromDimensions(
          rawOptions,
          {
            ...schemaProp[key][0],
            type: refType,
            refPath,
            ...rawOptions
          },
          name,
          key
        );
        break;
      case WhatIsIt.NONE:
        schemaProp[key] = {
          ...schemaProp[key],
          type: refType,
          refPath,
          ...rawOptions
        };
        break;
      default:
        throw new TypeError(format('"refPath" is not supported for "%s"! (%s, %s)', propKind, utils.getName(target), key));
    }

    return;
  }

  // check if Type is actually a real working Type
  if (utils.isNullOrUndefined(Type) || typeof Type !== 'function') {
    throw new InvalidTypeError(name, key, Type);
  }

  const enumOption = rawOptions.enum;
  if (!utils.isNullOrUndefined(enumOption)) {
    // check if the supplied value is already "mongoose-consumeable"
    if (!Array.isArray(enumOption)) {
      if (Type === String || Type === mongoose.Schema.Types.String) {
        rawOptions.enum = Object.entries<string>(enumOption) // get all key-value pairs of the enum
          // no reverse-filtering because if it is full of strings, there is no reverse mapping
          .map(([enumKey, enumValue]) => {
            // convert key-value pairs to an mongoose-usable enum
            // safeguard, this should never happen because TypeScript only sets "design:type" to "String"
            // if the enum is full of strings
            if (typeof enumValue !== 'string') {
              throw new NotStringTypeError(name, key, enumKey, typeof enumValue);
            }

            return enumValue;
          });
      } else if (Type === Number || Type === mongoose.Schema.Types.Number) {
        rawOptions.enum = Object.entries<string | number>(enumOption) // get all key-value pairs of the enum
          // filter out the "reverse (value -> name) mappings"
          // https://www.typescriptlang.org/docs/handbook/enums.html#reverse-mappings
          .filter(([enumKey, enumValue], _i, arr) => {
            // safeguard, this should never happen because typescript only sets "design:type" to "Number"
            // if the enum is full of numbers
            if (utils.isNullOrUndefined(enumValue) || arr.findIndex(([k]) => k === enumValue.toString()) <= -1) {
              // if there is no reverse mapping, throw an error
              throw new NotNumberTypeError(name, key, enumKey, typeof enumValue);
            }

            return typeof enumValue === 'number';
          })
          .map(([enumKey, enumValue]) => {
            // convert key-value pairs to an mongoose-useable enum
            if (typeof enumValue !== 'number') {
              throw new NotNumberTypeError(name, key, enumKey, typeof enumValue);
            }

            return enumValue;
          });
      } else {
        // this will happen if the enum type is not "String" or "Number"
        // most likely this error happened because the code got transpiled with babel or "tsc --transpile-only"
        throw new Error(
          `Invalid type used for enums!, got: "${Type}" (${name}.${key})`
          + 'Is the code transpiled with Babel or \'tsc --transpile-only\' or \'ts-node --transpile-only\'?\n'
          + 'See https://typegoose.github.io/typegoose/docs/api/decorators/prop/#enum'
        );
      }
    }
  }

  if (!utils.isNullOrUndefined(rawOptions.addNullToEnum)) {
    rawOptions.enum = Array.isArray(rawOptions.enum) ? rawOptions.enum : [];
    rawOptions.enum.push(null);
    delete rawOptions.addNullToEnum;
  }

  {
    // check for validation inconsistencies
    if (utils.isWithStringValidate(rawOptions) && !utils.isString(Type)) {
      throw new NotStringTypeError(name, key);
    }

    // check for transform inconsistencies
    if (utils.isWithStringTransform(rawOptions) && !utils.isString(Type)) {
      throw new NotStringTypeError(name, key);
    }

    if (utils.isWithNumberValidate(rawOptions) && !utils.isNumber(Type)) {
      throw new NotNumberTypeError(name, key);
    }
  }

  /** Is this Type (/Class) in the schemas Map? */
  const isInSchemas = schemas.has(utils.getName(Type));
  if (!isInSchemas && !utils.isPrimitive(Type) && !utils.isObject(Type)) {
    throw new InvalidPropError(Type.name, key); // This seems to be never thrown!
  }

  if (utils.isPrimitive(Type)) {
    if (utils.isObject(Type, true)) {
      utils.warnMixed(target, key);
    }
    switch (propKind) {
      case WhatIsIt.ARRAY:
        schemaProp[key] = {
          ...schemaProp[key][0],
          ...utils.mapArrayOptions(rawOptions, Type, target, key)
        };

        return;
      case WhatIsIt.MAP:
        const mapped = utils.mapOptions(rawOptions, Type, target, key);

        schemaProp[key] = {
          ...schemaProp[key],
          ...mapped.outer,
          type: Map,
          of: { type: Type, ...mapped.inner }
        };

        return;
      case WhatIsIt.NONE:
        schemaProp[key] = {
          ...schemaProp[key],
          ...rawOptions,
          type: Type
        };

        return;
      default:
        throw new Error(`"${propKind}"(whatis(primitive)) is invalid for "${name}.${key}"`);
    }
  }

  // If the 'Type' is not a 'Primitive Type' and no subschema was found treat the type as 'Object'
  // so that mongoose can store it as nested document
  if (utils.isObject(Type) && !isInSchemas) {
    utils.warnMixed(target, key);
    logger.warn(
      'if someone can see this message, please open an new issue at https://github.com/typegoose/typegoose/issues with reproduction code for tests'
    );
    schemaProp[key] = {
      ...schemaProp[key],
      ...rawOptions,
      type: mongoose.Schema.Types.Mixed
    };

    return;
  }

  const virtualSchema = buildSchema(Type);
  switch (propKind) {
    case WhatIsIt.ARRAY:
      schemaProp[key] = {
        ...schemaProp[key][0], // [0] is needed, because "initasArray" adds this (empty)
        ...utils.mapArrayOptions(rawOptions, virtualSchema, target, key, Type)
      };

      return;
    case WhatIsIt.MAP:
      const mapped = utils.mapOptions(rawOptions, virtualSchema, target, key, Type);

      schemaProp[key] = {
        ...schemaProp[key],
        ...mapped.outer,
        type: Map,
        of: { type: virtualSchema, ...mapped.inner }
      };

      return;
    case WhatIsIt.NONE:
      schemaProp[key] = {
        ...schemaProp[key],
        ...rawOptions,
        type: virtualSchema
      };

      return;
    default:
      throw new Error(`"${propKind}"(whatis(subSchema)) is invalid for "${name}.${key}"`);
  }
}

/**
 * Check for deprecated options, and if needed process them
 * @param options
 */
function optionDeprecation(options: any) {
  if ('refType' in options) {
    options.type = options.refType;
    delete options.refType;

    deprecate(() => undefined, 'Option "refType" is deprecated, use option "type"', 'TDEP0003')();
  }

  if ('of' in options) {
    deprecate(() => undefined, 'Option "of" is deprecated, use option "type"', 'TDEP0003')();
  }

  if ('items' in options) {
    deprecate(() => undefined, 'Option "items" is deprecated, use option "type"', 'TDEP0003')();
  }
}

/**
 * Detect "WhatIsIt" based on "Type"
 * @param Type The Type used for detection
 */
function detectWhatIsIt(Type: any): WhatIsIt {
  logger.debug('Detecting WhatIsIt');

  if (
    Type === Array ||
    Type === mongoose.Types.Array ||
    Type === mongoose.Schema.Types.Array ||
    Type === mongoose.Types.DocumentArray ||
    Type === mongoose.Schema.Types.DocumentArray
  ) {
    return WhatIsIt.ARRAY;
  }
  if (Type === Map || Type === mongoose.Types.Map || Type === mongoose.Schema.Types.Map) {
    return WhatIsIt.MAP;
  }

  return WhatIsIt.NONE;
}
