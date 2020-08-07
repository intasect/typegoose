import { assert, expect } from 'chai';

import { mongoose } from '../../src/typegoose';
import { isDocument, isDocumentArray, isRefType } from '../../src/typeguards';
import { IsRefType, IsRefTypeModel, IsRefTypeNestedObjectIdModel, IsRefTypeNestedStringModel } from '../models/isRefType';
import { UserRefModel } from '../models/userRefs';

/**
 * Function to pass into describe
 * ->Important: you need to always bind this
 */
export function suite() {
  describe('isDocument / isDocumentArray', () => {
    it('should guarantee array of document types', async () => {
      const UserMaster = await UserRefModel.create({
        name: 'master'
      });
      const UserSub = await UserRefModel.create({
        name: 'sub'
      });

      UserMaster.subAccounts.push(UserSub._id);

      await UserMaster.populate('subAccounts').execPopulate();

      if (isDocumentArray(UserMaster.subAccounts)) {
        expect(UserMaster.subAccounts).to.have.lengthOf(1);
        for (const doc of UserMaster.subAccounts) {
          expect(doc.name).to.be.equal('sub');
          expect(doc.name).to.not.be.equal('other');
        }
      } else {
        assert.fail('"UserMaster.subAccounts" is not populated!');
      }
    });

    it('should guarantee single document type', async () => {
      const UserMaster = await UserRefModel.create({
        name: 'master'
      });
      const UserSub = await UserRefModel.create({
        name: 'sub'
      });

      UserSub.master = UserMaster._id;

      await UserSub.populate('master').execPopulate();

      if (isDocument(UserSub.master)) {
        expect(UserSub.master.name).to.be.equal('master');
        expect(UserSub.master.name).to.not.be.equal('other');
      } else {
        assert.fail('"UserSub.master" is not populated!');
      }
    });

    it('should detect if array of refs is not populated', async () => {
      const UserMaster = await UserRefModel.create({
        name: 'master'
      });
      const UserSub = await UserRefModel.create({
        name: 'sub'
      });
      UserMaster.subAccounts.push(UserSub._id);

      if (!isDocumentArray(UserMaster.subAccounts)) {
        expect(UserMaster.subAccounts).to.have.lengthOf(1);
        for (const doc of UserMaster.subAccounts) {
          expect(doc).to.not.have.property('name');
        }
      } else {
        assert.fail('"UserMaster.subAccounts" is populated where it should not!');
      }
    });

    it('should detect if ref is not populated', async () => {
      const UserMaster = await UserRefModel.create({
        name: 'master'
      });
      const UserSub = await UserRefModel.create({
        name: 'sub'
      });

      UserSub.master = UserMaster._id;

      if (!isDocument(UserSub.master)) {
        expect(UserSub.master).to.not.have.property('name');
      } else {
        assert.fail('"UserSub.master" is populated where it should not!');
      }
    });

    it('should handle recursive populations - multiple populates', async () => {
      const User1 = await UserRefModel.create({
        name: '1'
      });
      const User2 = await UserRefModel.create({
        name: '2',
        master: User1._id
      });
      const User3 = await UserRefModel.create({
        name: '3',
        master: User2._id
      });

      await User3.populate('master').execPopulate();
      if (isDocument(User3.master)) {
        // User3.master === User2
        await User3.master.populate('master').execPopulate();
        if (isDocument(User3.master.master)) {
          // User3.master.master === User1
          expect(User3.master.master.name).to.be.equal(User1.name);
        } else {
          assert.fail('User3.master.master should be populated!');
        }
      } else {
        assert.fail('User3.master should be populated!');
      }

      await User3.populate({
        path: 'master',
        populate: {
          path: 'master'
        }
      }).execPopulate();
    });

    it('should handle recursive populations - single populate', async () => {
      const User1 = await UserRefModel.create({
        name: '1'
      });
      const User2 = await UserRefModel.create({
        name: '2',
        master: User1._id
      });
      const User3 = await UserRefModel.create({
        name: '3',
        master: User2._id
      });

      await User3.populate({
        path: 'master',
        populate: {
          path: 'master'
        }
      }).execPopulate();
      if (isDocument(User3.master) && isDocument(User3.master.master)) {
        // User3.master === User2 && User3.master.master === User1
        expect(User3.master.name).to.be.equal(User2.name);
        expect(User3.master.master.name).to.be.equal(User1.name);
      } else {
        assert.fail('"User3" should be deep populated!');
      }
    });
  });

  describe('isRefType / isRefTypeArray', () => {
    it('should guarantee the RefType - String', async () => {
      const doc = await IsRefTypeModel.create({
        nestedString: await IsRefTypeNestedStringModel.create({ _id: 'should guarantee the RefType' })
      } as IsRefType);
      doc.depopulate('nestedString');

      expect(doc.nestedString).to.not.equal(undefined);

      if (isRefType(doc.nestedString)) {
        expect(doc.nestedString).to.be.an('string');
      } else {
        assert.fail('Expected isRefType to be returning true');
      }
    });

    it('should guarantee the RefType - ObjectId', async () => {
      const doc = await IsRefTypeModel.create({
        nestedObjectId: await IsRefTypeNestedObjectIdModel.create({ _id: new mongoose.Types.ObjectId() })
      } as IsRefType);
      doc.depopulate('nestedObjectId');

      expect(doc.nestedObjectId).to.not.equal(undefined);

      if (isRefType(doc.nestedObjectId)) {
        expect(doc.nestedObjectId).to.be.an.instanceOf(mongoose.Types.ObjectId);
      } else {
        assert.fail('Expected isRefType to be returning true');
      }
    });
  });
}
