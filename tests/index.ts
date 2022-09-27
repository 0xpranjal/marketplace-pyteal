import algosdk from 'algosdk'
import * as fs from 'fs'

const server = 'http://localhost'
const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const algodClient = new algosdk.Algodv2(token, server, 4001)
const kmdClient = new algosdk.Kmd(token, server, 4002)
const kmdWallet = 'unencrypted-default-wallet'
const kmdPassword = ''

interface StateSchema {
  bytes: number
  ints: number
}

interface AppSchema {
  local: StateSchema,
  global: StateSchema
}

const schema = {
  local: {
    bytes: 0,
    ints: 0
  },
  global: {
    bytes: 0,
    ints: 0
  }
} as AppSchema

// Based on https://github.com/algorand-devrel/demo-abi/blob/master/js/sandbox.ts
async function getAccounts (): Promise<algosdk.Account[]> {
  const wallets = await kmdClient.listWallets()

  // find kmdWallet
  let walletId
  for (const wallet of wallets.wallets) {
    if (wallet.name === kmdWallet) walletId = wallet.id
  }
  if (walletId === undefined) throw Error('No wallet named: ' + kmdWallet)

  // get handle
  const handleResp = await kmdClient.initWalletHandle(walletId, kmdPassword)
  const handle = handleResp.wallet_handle_token

  // get account keys
  const addresses = await kmdClient.listKeys(handle)
  const acctPromises = []
  for (const addr of addresses.addresses) {
    acctPromises.push(kmdClient.exportKey(handle, kmdPassword, addr))
  }
  const keys = await Promise.all(acctPromises)

  // release handle
  kmdClient.releaseWalletHandle(handle)

  // return all algosdk.Account objects derived from kmdWallet
  return keys.map((k) => {
    const addr = algosdk.encodeAddress(k.private_key.slice(32))
    const acct = { sk: k.private_key, addr: addr } as algosdk.Account
    return acct
  })
}

// https://developer.algorand.org/docs/get-details/dapps/smart-contracts/frontend/apps/#create
async function compileProgram (programSource: string) {
  const encoder = new TextEncoder()
  const programBytes = encoder.encode(programSource)
  const compileResponse = await algodClient.compile(programBytes).do()
  const compiledBytes = new Uint8Array(Buffer.from(compileResponse.result, 'base64'))
  return compiledBytes
}

/*
Interfaces and function for making global state data from the node readable.
For example:
    [
      {
        key: 'YXVjdGlvbkVuZA==',
        value: { bytes: '', type: 2, uint: 1654814877 }
      },
      {
        key: 'aGlnaGVzdEJpZGRlcg==',
        value: {
          bytes: 'CKqsSJHzw81yK363IJzKm/DuK95cWwGBeEcxmVLlGgg=',
          type: 1,
          uint: 0
        }
      },
      {
        key: 'aGlnaGVzdEJpZA==',
        value: { bytes: '', type: 2, uint: 222222 }
      },
      {
        key: 'b3duZXI=',
        value: {
          bytes: '5ZKg7tCjd7z9TuDSKQPXSmbZWeksjzlgU7SRpzLCiUI=',
          type: 1,
          uint: 0
        }
      }
    ]

Becomes...

    {
      auctionEnd: 1654814877,
      highestBidder: 'BCVKYSER6PB424RLP23SBHGKTPYO4K66LRNQDALYI4YZSUXFDIEBTBV7GM',
      highestBid: 222222,
      owner: '4WJKB3WQUN33Z7KO4DJCSA6XJJTNSWPJFSHTSYCTWSI2OMWCRFBOCBYLIY'
    }
*/

interface GlobalStateDeltaValue {
    action: number,
    bytes?: string
    uint?: number
}

interface GlobalStateDelta {
    key: string
    value: GlobalStateDeltaValue
}

interface ReadableGlobalStateDelta {
    [key: string]: string | number | bigint | undefined
}

/* eslint-disable no-unused-vars */
function getReadableGlobalState (delta: Array<GlobalStateDelta>) {
  const r = {} as ReadableGlobalStateDelta

  delta.forEach(d => {
    const key = Buffer.from(d.key, 'base64').toString('utf8')
    let value = null

    if (d.value.bytes) {
      // first see if it's a valid address
      const b = new Uint8Array(Buffer.from(d.value.bytes as string, 'base64'))
      value = algosdk.encodeAddress(b)

      // then decode as string
      if (!algosdk.isValidAddress(value)) {
        value = Buffer.from(d.value.bytes as string, 'base64').toString()
      }
    } else {
      value = d.value.uint
    }

    r[key] = value
  })

  return r
}
/* eslint-enable no-unused-vars */

// use one account to fund another
async function fundAccount (from: algosdk.Account, to: algosdk.Account, amount: number) {
  const payObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: from.addr,
    to: to.addr,
    amount: amount
  }

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject(payObj).signTxn(from.sk)
  const { txId } = await algodClient.sendRawTransaction(txn).do()
  await algosdk.waitForConfirmation(algodClient, txId, 3)
}

// close the remaining balance of an account to another account
async function closeAccount (accountToClose: algosdk.Account, closeTo: algosdk.Account) {
  const txnObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: accountToClose.addr,
    to: accountToClose.addr,
    amount: 0,
    closeTo: closeTo
  }

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject(txnObj).signTxn(accountToClose.sk)
  const { txId } = await algodClient.sendRawTransaction(txn).do()
  await algosdk.waitForConfirmation(algodClient, txId, 3)
}

// create a dryrun object from an array of transactions
async function createDryRunFromTxns (txns: Array<Uint8Array>, desc: string, timestamp?: number) {
  const dTxns = txns.map(t => algosdk.decodeSignedTransaction(t))
  const dr = await algosdk.createDryrun({ client: algodClient, txns: dTxns, latestTimestamp: timestamp || 1 })
  fs.writeFileSync('./dryruns/' + desc + '.dr', algosdk.encodeObj(dr.get_obj_for_encoding(true)))
  return dr
}

// send txn to algod and wait for confirmation
/* eslint-disable no-unused-vars */
async function sendTxn (txn: Uint8Array | Array<Uint8Array>) {
  const { txId } = await algodClient.sendRawTransaction(txn).do()
  return await algosdk.waitForConfirmation(algodClient, txId, 3)
}
/* eslint-enable no-unused-vars */

async function createAppTxn (creator: algosdk.Account) {
  const approval = await compileProgram(fs.readFileSync('approval.teal').toString())
  const clear = await compileProgram(fs.readFileSync('clear.teal').toString())

  const appObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: creator.addr,
    numGlobalByteSlices: schema.global.bytes,
    numGlobalInts: schema.global.ints,
    approvalProgram: approval,
    clearProgram: clear
  } as any

  return algosdk.makeApplicationCreateTxnFromObject(appObj).signTxn(creator.sk)
}

describe('App Creation', () => {
  let funder: algosdk.Account
  let creator: algosdk.Account
  let appDrTxn: any

  beforeAll(async () => {
    const accounts = await getAccounts()
    funder = accounts[0]

    // create a new account to avoid app creation limit
    creator = algosdk.generateAccount()
    await fundAccount(funder, creator, 10_000_000)

    const appTxn = await createAppTxn(creator)
    const appDr = await createDryRunFromTxns([appTxn], 'app_create')
    const appDrRes = await algodClient.dryrun(appDr).do()
    appDrTxn = appDrRes.txns[0]
  })

  it('Passes approval program', () => {
    expect(appDrTxn['app-call-messages'][1]).toBe('PASS')
  })

  afterAll(async () => {
    await closeAccount(creator, funder)
  })
})
