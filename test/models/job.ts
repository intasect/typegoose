import { modelOptions, prop } from '../../src/typegoose';

@modelOptions({ schemaOptions: { _id: false } })
export class JobType {
  @prop({ required: true })
  public field!: string;

  @prop({ required: true })
  public salery!: number;
}

@modelOptions({ schemaOptions: { _id: false } })
export class Job {
  @prop()
  public title?: string;

  @prop()
  public position?: string;

  @prop({ required: true, default: Date.now })
  public startedAt?: Date;

  @prop({ _id: false })
  public jobType?: JobType;

  public titleInUppercase?() { // TODO: remove "?" when https://github.com/typegoose/typegoose/pull/241 should get merged
    return this.title.toUpperCase();
  }
}
