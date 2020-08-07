import { Types } from 'mongoose';

import { modelOptions } from './optionsProp';
import { DocumentType, RefType } from './types';

@modelOptions({ schemaOptions: { timestamps: true } })
/**
 * This class can be used for already existing type infomation for the Timestamps
 */
export abstract class TimeStamps {
  public createdAt!: Readonly<Date>;
  public updatedAt!: Readonly<Date>;
}

/**
 * This class provied the basic mongoose document properties
 */
export abstract class Base<T_ID extends RefType = Types.ObjectId> {
  public _id: T_ID;
  // tslint:disable-next-line:variable-name
  public __v: number;
  // tslint:disable-next-line:variable-name
  public __t: undefined | string | number;
}

export interface FindOrCreateResult<T> {
  created: boolean;
  doc: DocumentType<T>;
}

/**
 * This class contains all types for the module "mongoose-findorcreate"
 */
export abstract class FindOrCreate {
  public static findOrCreate: <T extends FindOrCreate>(
    this: new (...a: any[]) => T,
    condition: any
  ) => Promise<FindOrCreateResult<T>>;
}
