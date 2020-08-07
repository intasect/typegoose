import { DecoratorKeys } from './internal/constants';
import { assignGlobalModelOptions, assignMetadata } from './internal/utils';
import { IModelOptions } from './types';

/**
 * Define Options for the Class
 * @param options Options
 * @example Example:
 * ```
 *  @modelOptions({ schemaOptions: { timestamps: true } })
 *  class Name {}
 *
 *  // Note: The default Class "TimeStamps" can be used for type infomation and options already set
 * ```
 */
export function modelOptions(options: IModelOptions) {
  return (target: any) => {
    assignGlobalModelOptions(target);
    assignMetadata(DecoratorKeys.ModelOptions, options, target);
  };
}
