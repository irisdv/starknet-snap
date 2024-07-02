import { toJson } from './utils/serializer';
import { getAddrFromStarkNameUtil } from '../src/utils/starknetUtils';
import { ApiParams, GetAddrFromStarkNameRequestParam } from './types/snapApi';
import { getNetworkFromChainId } from './utils/snapUtils';
import { logger } from './utils/logger';

export async function getAddrFromStarkName(params: ApiParams) {
  try {
    const { state, requestParams } = params;
    const requestParamsObj = requestParams as GetAddrFromStarkNameRequestParam;

    logger.log(`1`);

    if (!requestParamsObj.starkName) {
      throw new Error(`The given stark name need to be non-empty string, got: ${toJson(requestParamsObj)}`);
    }

    logger.log(`2`);

    const starkName = requestParamsObj.starkName;

    logger.log(`3`);
    const network = getNetworkFromChainId(state, requestParamsObj.chainId);

    const resp = await getAddrFromStarkNameUtil(network, starkName);
    logger.log(`getAddrFromStarkName: addr:\n${toJson(resp)}`);

    return resp;
  } catch (err) {
    logger.error(`Problem found: ${err}`);
    throw err;
  }
}
