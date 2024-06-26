import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { WalletMock } from '../wallet.mock.test';
import * as utils from '../../src/utils/starknetUtils';
import { estimateFee } from '../../src/estimateFee';
import { SnapState } from '../../src/types/snapState';
import { ACCOUNT_CLASS_HASH, STARKNET_SEPOLIA_TESTNET_NETWORK } from '../../src/utils/constants';
import { getAddressKeyDeriver } from '../../src/utils/keyPair';
import {
  account2,
  Cairo1Account1,
  estimateDeployFeeResp4,
  estimateFeeResp,
  getBip44EntropyStub,
  getBalanceResp,
} from '../constants.test';
import { Mutex } from 'async-mutex';
import { ApiParams, EstimateFeeRequestParams } from '../../src/types/snapApi';
import { TransactionType } from 'starknet';

chai.use(sinonChai);
const sandbox = sinon.createSandbox();

describe('Test function: estimateFee', function () {
  const walletStub = new WalletMock();

  const state: SnapState = {
    accContracts: [],
    erc20Tokens: [],
    networks: [STARKNET_SEPOLIA_TESTNET_NETWORK],
    transactions: [],
  };
  const requestObject: EstimateFeeRequestParams = {
    contractAddress: '0x07394cbe418daa16e42b87ba67372d4ab4a5df0b05c6e554d158458ce245bc10',
    contractFuncName: 'balanceOf',
    contractCallData: '0x7426b2da7a8978e0d472d64f15f984d658226cb55a4fd8aa7689688a7eab37b',
    senderAddress: account2.address,
  };
  const apiParams: ApiParams = {
    state,
    requestParams: requestObject,
    wallet: walletStub,
    saveMutex: new Mutex(),
  };

  beforeEach(async function () {
    walletStub.rpcStubs.snap_getBip44Entropy.callsFake(getBip44EntropyStub);
    apiParams.keyDeriver = await getAddressKeyDeriver(walletStub);
    sandbox.stub(utils, 'callContract').resolves(getBalanceResp);
  });

  afterEach(function () {
    walletStub.reset();
    sandbox.restore();
  });

  describe('when request param validation fail', function () {
    let invalidRequest = Object.assign({}, requestObject);

    afterEach(async function () {
      invalidRequest = Object.assign({}, requestObject);
    });

    it('should throw an error if the function name is undefined', async function () {
      invalidRequest.contractFuncName = undefined;
      apiParams.requestParams = invalidRequest;
      let result;
      try {
        result = await estimateFee(apiParams);
      } catch (err) {
        result = err;
      } finally {
        expect(result).to.be.an('Error');
      }
    });

    it('should throw an error if the contract address is invalid', async function () {
      invalidRequest.contractAddress = 'wrongAddress';
      apiParams.requestParams = invalidRequest;
      let result;
      try {
        result = await estimateFee(apiParams);
      } catch (err) {
        result = err;
      } finally {
        expect(result).to.be.an('Error');
      }
    });

    it('should throw an error if the sender address is invalid', async function () {
      invalidRequest.senderAddress = 'wrongAddress';
      apiParams.requestParams = invalidRequest;
      let result;
      try {
        result = await estimateFee(apiParams);
      } catch (err) {
        result = err;
      } finally {
        expect(result).to.be.an('Error');
      }
    });
  });

  describe('when request param validation pass', function () {
    beforeEach(async function () {
      apiParams.requestParams = Object.assign({}, requestObject);
    });

    afterEach(async function () {
      apiParams.requestParams = Object.assign({}, requestObject);
    });

    describe('when account require upgrade', function () {
      let isUpgradeRequiredStub: sinon.SinonStub;
      beforeEach(async function () {
        isUpgradeRequiredStub = sandbox.stub(utils, 'isUpgradeRequired').resolves(true);
      });

      it('should throw error if upgrade required', async function () {
        let result;
        try {
          result = await estimateFee(apiParams);
        } catch (err) {
          result = err;
        } finally {
          expect(isUpgradeRequiredStub).to.have.been.calledOnceWith(STARKNET_SEPOLIA_TESTNET_NETWORK, account2.address);
          expect(result).to.be.an('Error');
        }
      });
    });

    describe('when account is not require upgrade', function () {
      let estimateFeeBulkStub: sinon.SinonStub;
      let estimateFeeStub: sinon.SinonStub;

      beforeEach(async function () {
        sandbox.stub(utils, 'isUpgradeRequired').resolves(false);
        apiParams.requestParams = {
          ...apiParams.requestParams,
          senderAddress: Cairo1Account1.address,
        };
      });

      describe('when account is deployed', function () {
        beforeEach(async function () {
          estimateFeeBulkStub = sandbox.stub(utils, 'estimateFeeBulk');
          sandbox.stub(utils, 'isAccountDeployed').resolves(true);
        });

        it('should estimate the fee correctly', async function () {
          estimateFeeStub = sandbox.stub(utils, 'estimateFee').resolves(estimateFeeResp);
          const result = await estimateFee(apiParams);
          expect(result.suggestedMaxFee).to.be.eq(estimateFeeResp.suggestedMaxFee.toString(10));
          expect(estimateFeeStub).callCount(1);
          expect(estimateFeeBulkStub).callCount(0);
        });
      });

      describe('when account is not deployed', function () {
        beforeEach(async function () {
          estimateFeeStub = sandbox.stub(utils, 'estimateFee');
          sandbox.stub(utils, 'isAccountDeployed').resolves(false);
        });

        it('should estimate the fee including deploy txn correctly', async function () {
          estimateFeeBulkStub = sandbox
            .stub(utils, 'estimateFeeBulk')
            .resolves([estimateFeeResp, estimateDeployFeeResp4]);
          const expectedSuggestedMaxFee = estimateDeployFeeResp4.suggestedMaxFee + estimateFeeResp.suggestedMaxFee;
          const result = await estimateFee(apiParams);

          const { privateKey, publicKey } = await utils.getKeysFromAddress(
            apiParams.keyDeriver,
            STARKNET_SEPOLIA_TESTNET_NETWORK,
            state,
            Cairo1Account1.address,
          );
          const { callData } = utils.getAccContractAddressAndCallData(publicKey);
          const apiRequest = apiParams.requestParams as EstimateFeeRequestParams;

          const expectedBulkTransaction = [
            {
              type: TransactionType.DEPLOY_ACCOUNT,
              payload: {
                classHash: ACCOUNT_CLASS_HASH,
                contractAddress: Cairo1Account1.address,
                constructorCalldata: callData,
                addressSalt: publicKey,
              },
            },
            {
              type: TransactionType.INVOKE,
              payload: {
                contractAddress: apiRequest.contractAddress,
                entrypoint: apiRequest.contractFuncName,
                calldata: utils.getCallDataArray(apiRequest.contractCallData),
              },
            },
          ];

          expect(result.suggestedMaxFee).to.be.eq(expectedSuggestedMaxFee.toString(10));
          expect(estimateFeeStub).callCount(0);
          expect(estimateFeeBulkStub).callCount(1);
          expect(estimateFeeBulkStub).to.be.calledWith(
            STARKNET_SEPOLIA_TESTNET_NETWORK,
            Cairo1Account1.address,
            privateKey,
            expectedBulkTransaction,
          );
        });

        it('should throw error if estimateFee failed', async function () {
          estimateFeeBulkStub = sandbox.stub(utils, 'estimateFeeBulk').throws('Error');
          apiParams.requestParams = requestObject;

          let result;
          try {
            await estimateFee(apiParams);
          } catch (err) {
            result = err;
          } finally {
            expect(result).to.be.an('Error');
            expect(estimateFeeStub).callCount(0);
            expect(estimateFeeBulkStub).callCount(1);
          }
        });
      });
    });
  });
});
